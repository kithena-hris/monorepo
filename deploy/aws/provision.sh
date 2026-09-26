#!/usr/bin/env bash
# The AWS half of the backend host: one EC2 instance, what it takes to sleep
# and wake it, and the S3 buckets it writes to. The AWS CLI and nothing else;
# run by hand, never by CI.
#
#   deploy/aws/provision.sh --vercel-team kithena \
#     --budget-email ops@example.com --operator-ip 203.0.113.7 [--apply]
#
# Prints every change it would make and makes none until `--apply`. Idempotent:
# each resource is looked up first and created only when missing; the policies
# are re-put every run, so running it again is how a change here reaches AWS.
#
#   buckets          kithena-<account>-uploads, -exports and -backups: Block
#                    Public Access, SSE-S3 by default, BucketOwnerEnforced,
#                    unversioned, TLS only, and lifecycle rules matching
#                    People's key layout (uploads: a day; exports/ and
#                    dry-runs/: 2 days, imports/: 8; backups: 30). The uploads
#                    bucket takes a browser PUT from the tenant app (CORS).
#   instance role    kithena-vm, the instance profile: Get/Put/Delete/List on
#                    uploads and exports, Get/Put/List on backups (no delete:
#                    the lifecycle rule deletes). People and `backup.sh` reach
#                    it through IMDSv2, so no access key exists.
#   instance         c7i-flex.large, Ubuntu 24.04 amd64 (Canonical's SSM
#                    parameter), 30 GB gp3 encrypted, IMDSv2 only with a hop
#                    limit of 2 (People runs in a container, one hop further
#                    from IMDS than the host), a public
#                    IPv4 that is released while stopped, termination
#                    protection, and InstanceInitiatedShutdownBehavior=stop:
#                    `idle-stop.sh` ends in `shutdown -h now`, and that must stop
#                    the instance, not terminate it.
#   security group   no inbound rule but SSH from `--operator-ip`, for the one
#                    bootstrap before Tailscale; `--close-ssh` removes it after.
#   wake role        assumed by the tenant app's Vercel project through Vercel's
#                    OIDC issuer (team issuer mode), scoped to the team, the
#                    project and the environment. May start this one instance
#                    and describe instances; Describe* has no resource-level
#                    permissions in EC2, so it cannot be narrower than `*`.
#   deploy role      the same permissions for the production deploy workflow,
#                    through GitHub's OIDC issuer and the `production`
#                    environment, so a deploy can wake the VM it deploys to.
#   schedule         optional (`--start-hour`/`--stop-hour`): EventBridge
#                    Scheduler starts it on weekday mornings and stops it every
#                    night, through a role that may do only that.
#   budget           usage before credits, alerting at $1, $10 and $50 a month.
#
# `docs/environments.md` "The AWS host" has the checklist around this.
set -euo pipefail

usage() {
  sed -n '6,7p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
  --region R            AWS region, default us-east-1
  --vercel-team SLUG    Vercel team slug, the OIDC issuer's path (required)
  --budget-email ADDR   where the budget alerts go (required)
  --operator-ip IP      allow SSH from this address only, for the bootstrap
  --close-ssh           remove every inbound rule (after Tailscale is up)
  --key-name NAME       an existing EC2 key pair for that first SSH
  --vercel-project P    default kithena-web-production
  --vercel-env E        default production
  --github-repo O/R     default kithena-hris/monorepo
  --start-hour H        start weekdays at H:00 (with --stop-hour)
  --stop-hour H         stop every day at H:00
  --timezone TZ         for the schedule, default UTC
  --apply               make the changes; without it, only print them
EOF
}

region=us-east-1 team='' email='' operator_ip='' key_name='' close_ssh='' apply=''
project=kithena-web-production vercel_env=production repo=kithena-hris/monorepo
start_hour='' stop_hour='' tz=UTC
while [ $# -gt 0 ]; do
  case "$1" in
    --region) region="$2"; shift 2 ;;
    --vercel-team) team="$2"; shift 2 ;;
    --budget-email) email="$2"; shift 2 ;;
    --operator-ip) operator_ip="$2"; shift 2 ;;
    --close-ssh) close_ssh=1; shift ;;
    --key-name) key_name="$2"; shift 2 ;;
    --vercel-project) project="$2"; shift 2 ;;
    --vercel-env) vercel_env="$2"; shift 2 ;;
    --github-repo) repo="$2"; shift 2 ;;
    --start-hour) start_hour="$2"; shift 2 ;;
    --stop-hour) stop_hour="$2"; shift 2 ;;
    --timezone) tz="$2"; shift 2 ;;
    --apply) apply=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$team" ] && [ -n "$email" ] || { usage >&2; exit 2; }
if [ -n "$start_hour$stop_hour" ] && ! [[ "$start_hour" =~ ^[0-9]+$ && "$stop_hour" =~ ^[0-9]+$ ]]; then
  echo "--start-hour and --stop-hour go together, as hours" >&2
  exit 2
fi
export AWS_REGION="$region" AWS_PAGER=""

NAME=kithena-vm
TYPE=c7i-flex.large
AMI_PARAM=/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id
VERCEL_ISSUER="oidc.vercel.com/$team"
GITHUB_ISSUER=token.actions.githubusercontent.com
# The tenant app, production and staging. S3 takes one `*` per origin.
CORS_ORIGINS='"https://*.app.kithena.com","https://*.staging.app.kithena.com"'

# Reads always run: they are how the plan knows what exists. In a dry run
# without credentials they come back empty, and the plan says "create".
read_() { aws "$@" 2>/dev/null || true; }
# Writes print always and run only with `--apply`.
act() {
  printf '+ aws'
  printf ' %q' "$@"
  printf '\n'
  [ -n "$apply" ] && aws "$@"
  return 0
}
say() { printf '\n== %s\n' "$*"; }

account="$(read_ sts get-caller-identity --query Account --output text)"
if [ -z "$account" ]; then
  [ -n "$apply" ] && { echo "no AWS credentials: aws sso login first" >&2; exit 1; }
  account='<account>'
fi
echo "account $account, region $region, $([ -n "$apply" ] && echo APPLYING || echo 'dry run: nothing changes')"

say "security group"
vpc="$(read_ ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
[ "$vpc" = None ] && vpc=
[ -n "$vpc" ] || vpc='<default vpc>'
sg="$(read_ ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" "Name=vpc-id,Values=$vpc" \
  --query 'SecurityGroups[0].GroupId' --output text)"
[ "$sg" = None ] && sg=
if [ -z "$sg" ]; then
  act ec2 create-security-group --group-name "$NAME" --vpc-id "$vpc" \
    --description 'kithena VM: no inbound; Tailscale and Cloudflare Tunnel dial out' \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=kithena}]"
  [ -n "$apply" ] && sg="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" \
    "Name=vpc-id,Values=$vpc" --query 'SecurityGroups[0].GroupId' --output text)"
  [ -n "$sg" ] || sg='<new security group>'
else
  echo "exists: $sg"
fi
if [ -n "$close_ssh" ]; then
  rules="$(read_ ec2 describe-security-group-rules --filters "Name=group-id,Values=$sg" \
    --query 'SecurityGroupRules[?!IsEgress].SecurityGroupRuleId' --output text)"
  if [ -n "$rules" ] && [ "$rules" != None ]; then
    # shellcheck disable=SC2086 # one argument per rule id
    act ec2 revoke-security-group-ingress --group-id "$sg" --security-group-rule-ids $rules
  else
    echo "no inbound rules"
  fi
elif [ -n "$operator_ip" ]; then
  has="$(read_ ec2 describe-security-group-rules --filters "Name=group-id,Values=$sg" \
    --query "SecurityGroupRules[?!IsEgress && CidrIpv4=='$operator_ip/32' && FromPort==\`22\`].SecurityGroupRuleId" \
    --output text)"
  if [ -z "$has" ] || [ "$has" = None ]; then
    act ec2 authorize-security-group-ingress --group-id "$sg" --protocol tcp --port 22 --cidr "$operator_ip/32"
  else
    echo "SSH from $operator_ip already allowed"
  fi
fi

role() { # <name> <trust policy> <inline policy>
  if [ -n "$(read_ iam get-role --role-name "$1" --query Role.Arn --output text)" ]; then
    echo "exists: $1"
    act iam update-assume-role-policy --role-name "$1" --policy-document "$2"
  else
    act iam create-role --role-name "$1" --assume-role-policy-document "$2" \
      --max-session-duration 3600 --tags Key=app,Value=kithena
  fi
  act iam put-role-policy --role-name "$1" --policy-name "$1" --policy-document "$3"
}

# Bucket names are global, so the account id is in them.
UPLOADS="kithena-$account-uploads" EXPORTS="kithena-$account-exports" BACKUPS="kithena-$account-backups"
# `bucket <name> <lifecycle rules, a JSON array>`: private, SSE-S3,
# owner-enforced, unversioned, TLS only. Created once; the rest is re-put.
bucket() {
  say "bucket $1"
  if aws s3api head-bucket --bucket "$1" >/dev/null 2>&1; then
    echo "exists: $1"
  elif [ "$region" = us-east-1 ]; then
    act s3api create-bucket --bucket "$1" --object-ownership BucketOwnerEnforced
  else
    act s3api create-bucket --bucket "$1" --object-ownership BucketOwnerEnforced \
      --create-bucket-configuration "LocationConstraint=$region"
  fi
  act s3api put-public-access-block --bucket "$1" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  act s3api put-bucket-ownership-controls --bucket "$1" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
  act s3api put-bucket-encryption --bucket "$1" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  # A new bucket is unversioned; one that was versioned can only be suspended.
  if [ "$(read_ s3api get-bucket-versioning --bucket "$1" --query Status --output text)" = Enabled ]; then
    act s3api put-bucket-versioning --bucket "$1" --versioning-configuration Status=Suspended
  fi
  act s3api put-bucket-policy --bucket "$1" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"TlsOnly\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::$1\",\"arn:aws:s3:::$1/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"
  act s3api put-bucket-lifecycle-configuration --bucket "$1" --lifecycle-configuration "{\"Rules\":$2}"
}
# `rule <id> <prefix> <days>`: expire after that many days, and abort a
# multipart upload left unfinished for a day.
rule() {
  printf '{"ID":"%s","Status":"Enabled","Filter":{"Prefix":"%s"},"Expiration":{"Days":%s},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}' "$1" "$2" "$3"
}
# Lifecycle filters are prefixes, not globs, so every People key starts with
# its lifetime: exports/<tenant>/… and dry-runs/<tenant>/… (a day's link, kept
# 2), imports/<tenant>/… (a week's report, kept 8). People's own sweep deletes
# on time; these rules are the backstop for a sweep that never ran.
bucket "$UPLOADS" "[$(rule uploads-1-day '' 1)]"
# The browser PUTs here with People's presigned URL: only PUT, only the tenant
# app's origins, only the headers the URL signs, nothing exposed.
act s3api put-bucket-cors --bucket "$UPLOADS" --cors-configuration "{\"CORSRules\":[{\"AllowedOrigins\":[$CORS_ORIGINS],\"AllowedMethods\":[\"PUT\"],\"AllowedHeaders\":[\"content-type\",\"if-none-match\",\"x-amz-server-side-encryption\"],\"MaxAgeSeconds\":3600}]}"
bucket "$EXPORTS" "[$(rule exports-2-days exports/ 2),$(rule dry-runs-2-days dry-runs/ 2),$(rule imports-8-days imports/ 8)]"
bucket "$BACKUPS" "[$(rule backups-30-days '' 30)]"

say "instance role kithena-vm"
role kithena-vm \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  "$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"ListTheThreeBuckets","Effect":"Allow","Action":"s3:ListBucket",
  "Resource":["arn:aws:s3:::$UPLOADS","arn:aws:s3:::$EXPORTS","arn:aws:s3:::$BACKUPS"]},
 {"Sid":"UploadsAndExports","Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],
  "Resource":["arn:aws:s3:::$UPLOADS/*","arn:aws:s3:::$EXPORTS/*"]},
 {"Sid":"BackupsWithoutDelete","Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:AbortMultipartUpload"],
  "Resource":"arn:aws:s3:::$BACKUPS/*"}]}
EOF
)"
if [ -n "$(read_ iam get-instance-profile --instance-profile-name kithena-vm --query InstanceProfile.Arn --output text)" ]; then
  echo "exists: instance profile kithena-vm"
else
  act iam create-instance-profile --instance-profile-name kithena-vm --tags Key=app,Value=kithena
  act iam add-role-to-instance-profile --instance-profile-name kithena-vm --role-name kithena-vm
  # EC2 refuses a profile for a few seconds after IAM has made it.
  if [ -n "$apply" ]; then
    aws iam wait instance-profile-exists --instance-profile-name kithena-vm
    sleep 15
  fi
fi

say "instance"
instance="$(read_ ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)"
[ "$instance" = None ] && instance=
if [ -z "$instance" ]; then
  ami="$(read_ ssm get-parameter --name "$AMI_PARAM" --query Parameter.Value --output text)"
  [ -n "$ami" ] || ami='<ubuntu 24.04 amd64 ami>'
  key=()
  [ -n "$key_name" ] && key=(--key-name "$key_name")
  act ec2 run-instances --image-id "$ami" --instance-type "$TYPE" --count 1 ${key[@]+"${key[@]}"} \
    --network-interfaces "DeviceIndex=0,AssociatePublicIpAddress=true,Groups=$sg" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=2 \
    --iam-instance-profile Name=kithena-vm \
    --instance-initiated-shutdown-behavior stop \
    --disable-api-termination \
    --tag-specifications \
    "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=kithena}]" \
    "ResourceType=volume,Tags=[{Key=Name,Value=$NAME},{Key=app,Value=kithena}]"
  [ -n "$apply" ] && instance="$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" \
    "Name=instance-state-name,Values=pending,running" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text)"
  [ -n "$instance" ] || instance='<new instance>'
else
  echo "exists: $instance"
  # Re-asserted: the attributes everything here depends on.
  act ec2 modify-instance-attribute --instance-id "$instance" \
    --instance-initiated-shutdown-behavior Value=stop
  act ec2 modify-instance-metadata-options --instance-id "$instance" \
    --http-tokens required --http-endpoint enabled --http-put-response-hop-limit 2
  association="$(read_ ec2 describe-iam-instance-profile-associations \
    --filters "Name=instance-id,Values=$instance" Name=state,Values=associated \
    --query 'IamInstanceProfileAssociations[0].AssociationId' --output text)"
  if [ -z "$association" ] || [ "$association" = None ]; then
    act ec2 associate-iam-instance-profile --instance-id "$instance" --iam-instance-profile Name=kithena-vm
  else
    echo "instance profile attached: $association"
  fi
fi
instance_arn="arn:aws:ec2:$region:$account:instance/$instance"

# `start-and-describe <role> <trust json>`: a role that may start this one
# instance and describe instances, and nothing else.
wake_policy="$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"StartThisInstance","Effect":"Allow","Action":"ec2:StartInstances","Resource":"$instance_arn"},
 {"Sid":"DescribeHasNoResourceLevelPermissions","Effect":"Allow",
  "Action":["ec2:DescribeInstances","ec2:DescribeInstanceStatus"],"Resource":"*"}]}
EOF
)"
oidc_provider() { # <issuer host/path> <audience>
  local arn="arn:aws:iam::$account:oidc-provider/$1"
  if [ -n "$(read_ iam get-open-id-connect-provider --open-id-connect-provider-arn "$arn" --query Url --output text)" ]; then
    echo "exists: $arn"
  else
    act iam create-open-id-connect-provider --url "https://$1" --client-id-list "$2"
  fi
}

say "wake role for Vercel ($team/$project, $vercel_env)"
oidc_provider "$VERCEL_ISSUER" "https://vercel.com/$team"
role kithena-workspace-wake "$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Federated":"arn:aws:iam::$account:oidc-provider/$VERCEL_ISSUER"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{
  "$VERCEL_ISSUER:aud":"https://vercel.com/$team",
  "$VERCEL_ISSUER:sub":"owner:$team:project:$project:environment:$vercel_env"}}}]}
EOF
)" "$wake_policy"

say "wake role for the deploy workflow ($repo, environment production)"
oidc_provider "$GITHUB_ISSUER" sts.amazonaws.com
role kithena-deploy-wake "$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Federated":"arn:aws:iam::$account:oidc-provider/$GITHUB_ISSUER"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{
  "$GITHUB_ISSUER:aud":"sts.amazonaws.com",
  "$GITHUB_ISSUER:sub":"repo:$repo:environment:production"}}}]}
EOF
)" "$wake_policy"

if [ -n "$start_hour" ]; then
  say "schedule: start weekdays $start_hour:00, stop daily $stop_hour:00 ($tz)"
  role kithena-vm-scheduler "$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole",
 "Condition":{"StringEquals":{"aws:SourceAccount":"$account"}}}]}
EOF
)" "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"ec2:StartInstances\",\"ec2:StopInstances\"],\"Resource\":\"$instance_arn\"}]}"
  scheduler_role="arn:aws:iam::$account:role/kithena-vm-scheduler"
  schedule() { # <name> <cron> <start|stop>
    local verb=create-schedule
    [ -n "$(read_ scheduler get-schedule --name "$1" --query Name --output text)" ] && verb=update-schedule
    act scheduler "$verb" --name "$1" --schedule-expression "cron($2)" \
      --schedule-expression-timezone "$tz" --flexible-time-window Mode=OFF \
      --target "{\"Arn\":\"arn:aws:scheduler:::aws-sdk:ec2:${3}Instances\",\"RoleArn\":\"$scheduler_role\",\"Input\":\"{\\\"InstanceIds\\\":[\\\"$instance\\\"]}\"}"
  }
  schedule kithena-vm-start "0 $start_hour ? * MON-FRI *" start
  # A plain stop, not `idle-stop.sh`: systemd stops Docker, which stops each
  # container gracefully, and the nightly backup catches up at the next boot.
  schedule kithena-vm-stop "0 $stop_hour * * ? *" stop
fi

say "budget alerts to $email"
if [ -n "$(read_ budgets describe-budget --region us-east-1 --account-id "$account" --budget-name kithena-monthly \
  --query Budget.BudgetName --output text)" ]; then
  echo "exists: kithena-monthly"
else
  # Credits excluded: what the account uses, not what is left to pay, so the
  # alerts track the credits being spent while the Free plan covers them.
  notify() {
    printf '{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":%s,"ThresholdType":"ABSOLUTE_VALUE"},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"%s"}]}' "$1" "$email"
  }
  act budgets create-budget --region us-east-1 --account-id "$account" \
    --budget '{"BudgetName":"kithena-monthly","BudgetLimit":{"Amount":"50","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST","CostTypes":{"IncludeCredit":false,"IncludeRefund":false}}' \
    --notifications-with-subscribers "[$(notify 1),$(notify 10),$(notify 50)]"
fi

say "settings"
cat <<EOF
Vercel, project $project ($vercel_env) — or the repository variables the
production workflow passes to it:
  WORKSPACE_INSTANCE_ID=$instance
  AWS_ROLE_ARN=arn:aws:iam::$account:role/kithena-workspace-wake
  AWS_REGION=$region
PEOPLE_ENV, the production environment secret: the two stores, with no
endpoint and no keys, so People uses S3 through the instance role:
  PEOPLE_UPLOAD_BUCKET=$UPLOADS
  PEOPLE_UPLOAD_S3_REGION=$region
  PEOPLE_EXPORT_BUCKET=$EXPORTS
  PEOPLE_EXPORT_S3_REGION=$region
Backups go to $BACKUPS; backup.sh works that out on the instance.
GitHub repository variables, for the deploy workflow's wake step:
  WORKSPACE_INSTANCE_ID_PRODUCTION=$instance
  AWS_ROLE_ARN_PRODUCTION=arn:aws:iam::$account:role/kithena-workspace-wake
  AWS_DEPLOY_ROLE_ARN=arn:aws:iam::$account:role/kithena-deploy-wake
  AWS_REGION=$region
  VM_PLATFORM=linux/amd64
EOF
[ -n "$apply" ] || echo "dry run: rerun with --apply to make these changes"

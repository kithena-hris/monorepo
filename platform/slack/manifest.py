"""The Kithena Slack app's manifest for one environment: manifest.json with its
name, slash command and "Add to Slack" return address made that environment's,
so three apps can sit in one workspace without their commands colliding.
Prints JSON."""
import json, sys

ENVS = {
    # "Add to Slack" returns to the auth origin, which has to be HTTPS; a
    # developer's workspace is connected from .env instead.
    'development': {'name': 'Kithena Dev', 'command': '/kithena-dev', 'auth': None},
    'staging': {'name': 'Kithena Staging', 'command': '/kithena-staging',
                'auth': 'https://auth.staging.app.kithena.com'},
    'production': {'name': 'Kithena', 'command': '/kithena', 'auth': 'https://auth.app.kithena.com'},
}

env = sys.argv[1]
m = json.load(open('manifest.json'))
m['display_information']['name'] = ENVS[env]['name']
m['features']['bot_user']['display_name'] = ENVS[env]['name']
m['features']['slash_commands'][0]['command'] = ENVS[env]['command']
m['features']['slash_commands'][0]['usage_hint'] = 'who reports to Michael?'
m['display_information']['long_description'] = m['display_information']['long_description'].replace(
    '/kithena ', ENVS[env]['command'] + ' ')
if ENVS[env]['auth']:
    m['oauth_config']['redirect_urls'] = [ENVS[env]['auth'] + '/chat/slack/done']
print(json.dumps(m))

"""The Kithena Slack app's manifest for one environment: manifest.json with its
name and slash command made that environment's, so three apps can sit in one
workspace without their commands colliding. Prints JSON."""
import json, sys

ENVS = {
    'development': {'name': 'Kithena Dev', 'command': '/kithena-dev'},
    'staging': {'name': 'Kithena Staging', 'command': '/kithena-staging'},
    'production': {'name': 'Kithena', 'command': '/kithena'},
}

env = sys.argv[1]
m = json.load(open('manifest.json'))
m['display_information']['name'] = ENVS[env]['name']
m['features']['bot_user']['display_name'] = ENVS[env]['name']
m['features']['slash_commands'][0]['command'] = ENVS[env]['command']
m['features']['slash_commands'][0]['usage_hint'] = 'who reports to Michael?'
m['display_information']['long_description'] = m['display_information']['long_description'].replace(
    '/kithena ', ENVS[env]['command'] + ' ')
print(json.dumps(m))

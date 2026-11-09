"""Read-only monitor for the three isolated provider stacks. No release approval."""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'evidence/physical-isolation-resources-2026-11-10.json'
SHA = re.compile(r'[0-9a-f]{40}')
MAX_AGE_SECONDS = 7 * 3600
REQUEST_TIMEOUT_SECONDS = 15
MAX_RESPONSE_BYTES = 65536
MAX_ATTEMPTS = 3


def now():
    return datetime.now(timezone.utc)


class ProbeError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ProbeError('HTTP_REDIRECT_' + str(code))


def fetch_json(url):
    request = urllib.request.Request(url, headers={
        'Accept': 'application/json', 'User-Agent': 'SoftTech-health-monitor/2',
        'Cache-Control': 'no-cache',
    })
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise ProbeError('HTTP_' + str(response.status))
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise ProbeError('HTTP_' + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ProbeError('NETWORK_' + type(error).__name__) from None
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ProbeError('RESPONSE_TOO_LARGE')
    try:
        value = json.loads(payload)
    except (ValueError, UnicodeError):
        raise ProbeError('INVALID_JSON') from None
    if not isinstance(value, dict):
        raise ProbeError('INVALID_JSON_OBJECT')
    return value


def targets(manifest):
    entries = []
    seen_services, seen_origins, seen_projects = set(), set(), set()
    environments = manifest.get('environments', [])
    if {e.get('environment') for e in environments} != {'sandbox', 'preproduction', 'production'} or len(environments) != 3:
        raise ValueError('THREE_ENVIRONMENTS_REQUIRED')
    for env in environments:
        if env['project_id'] in seen_projects:
            raise ValueError('PROJECT_REUSED')
        seen_projects.add(env['project_id'])
        for kind in ('core', 'wallet', 'uno', 'mahjong', 'skygate'):
            origin, service = env['origins'][kind], env['services'][kind]
            if not origin.startswith('https://') or origin in seen_origins or service in seen_services:
                raise ValueError('SERVICE_OR_ORIGIN_REUSED')
            seen_services.add(service)
            seen_origins.add(origin)
            entries.append(dict(name=env['environment'] + '/' + kind, kind=kind,
                                environment=env['environment'], deployment_id=service,
                                core_audience=env['services']['core'], origin=origin,
                                backup_required=kind != 'wallet'))
    return entries


def validate(target, health, backup, checked):
    errors = []
    source = health.get('source_commit')
    identity = health.get('deployment_identity') or health.get('identity') or {}
    if health.get('ok') is not True:
        errors.append('HEALTH_NOT_OK')
    if not isinstance(source, str) or not SHA.fullmatch(source):
        errors.append('INVALID_SOURCE_COMMIT')
    if identity.get('environment') != target['environment'] or identity.get('deployment_id') != target['deployment_id']:
        errors.append('DEPLOYMENT_IDENTITY_MISMATCH')
    if target['kind'] != 'core':
        audience = identity.get('core_audience') if target['kind'] == 'wallet' else identity.get('core_deployment_id')
        if audience != target['core_audience']:
            errors.append('CORE_AUDIENCE_MISMATCH')
    if target['kind'] == 'core' and health.get('isolation_readiness', {}).get('ok') is not True:
        errors.append('ISOLATION_NOT_VERIFIED')
    if target['environment'] == 'production':
        if target['kind'] in ('core', 'wallet') and health.get('production_enabled') is not False:
            errors.append('PRODUCTION_QUARANTINE_MISSING')
        if target['kind'] not in ('core', 'wallet') and health.get('play_enabled', identity.get('play_enabled')) is not False:
            errors.append('PRODUCTION_GAMEPLAY_QUARANTINE_MISSING')
    verified_at = None
    age = None
    if target['backup_required']:
        if backup.get('ok') is not True or backup.get('backup_verified') is not True:
            errors.append('REMOTE_BACKUP_NOT_VERIFIED')
        if backup.get('source_commit') != source:
            errors.append('BACKUP_SOURCE_MISMATCH')
        try:
            stamp = backup.get('verified_at')
            parsed = datetime.fromisoformat(stamp[:-1] + '+00:00' if stamp.endswith('Z') else stamp)
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError('Timezone required')
            verified_at = parsed.astimezone(timezone.utc).isoformat()
            age = (checked - parsed).total_seconds()
            if age < 0 or age > MAX_AGE_SECONDS:
                errors.append('BACKUP_TIMESTAMP_OUT_OF_POLICY')
        except (ValueError, TypeError, AttributeError, OverflowError):
            errors.append('INVALID_BACKUP_TIMESTAMP')
    return dict(ok=not errors, errors=errors, source_commit=source,
                verified_at=verified_at, backup_age_seconds=age,
                backup_scope='verified_remote_restore' if target['backup_required'] else 'not_covered_reference_wallet',
                identity=identity)


def check(target, fetch=fetch_json, clock=now, wait=time.sleep):
    attempts = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        health, backup, transport = {}, {}, []
        for endpoint in ('/health', '/health/backup') if target['backup_required'] else ('/health',):
            try:
                value = fetch(target['origin'] + endpoint)
                if endpoint == '/health':
                    health = value
                else:
                    backup = value
            except ProbeError as error:
                transport.append(endpoint + ':' + str(error))
        checked = clock()
        result = validate(target, health, backup, checked)
        result['errors'] = transport + result['errors']
        result.update(ok=not result['errors'], attempt=attempt, checked_at=checked.isoformat())
        attempts.append(result)
        if result['ok']:
            break
        if attempt < MAX_ATTEMPTS:
            wait(5)
    return dict(**target, ok=attempts[-1]['ok'], attempts=attempts)


def main():
    output = Path(os.getenv('HEALTH_EVIDENCE_DIR', 'health-evidence'))
    output.mkdir(exist_ok=True)
    report = dict(schema='softtech.health-monitor.v2', run_id=os.getenv('GITHUB_RUN_ID'),
                  monitor_workflow_sha=os.getenv('GITHUB_SHA'), started_at=now().isoformat(),
                  status='verifier_not_completed', services=[], production_approval=False,
                  policy=dict(max_backup_age_seconds=MAX_AGE_SECONDS, max_attempts=MAX_ATTEMPTS,
                              request_timeout_seconds=REQUEST_TIMEOUT_SECONDS))
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    try:
        entries = targets(json.loads(MANIFEST.read_text()))
        with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
            report['services'] = list(executor.map(check, entries))
        report['ok'] = len(report['services']) == 15 and all(s['ok'] for s in report['services'])
        report['status'] = 'passed' if report['ok'] else 'failed'
    except Exception as error:
        report.update(ok=False, status='failed', error='VERIFIER_' + type(error).__name__)
    report['finished_at'] = now().isoformat()
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    summary = ['## Isolated provider stacks', '', '| Service | Result | Source | Backup scope | Errors |',
               '| --- | --- | --- | --- | --- |']
    for service in report['services']:
        last = service['attempts'][-1]
        row = [service['name'], 'PASS' if service['ok'] else 'FAIL',
               (last.get('source_commit') or 'unknown')[:12], last['backup_scope'], ', '.join(last['errors']) or 'none']
        summary.append('| ' + ' | '.join(row) + ' |')
        print(json.dumps(dict(service=service['name'], ok=service['ok'], errors=last['errors'])))
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write('\n'.join(summary) + '\n')
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

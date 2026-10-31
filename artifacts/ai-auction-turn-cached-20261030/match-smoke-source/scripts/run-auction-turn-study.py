#!/usr/bin/env python3
"""Supervise the frozen 2s study; run under caffeinate until verification ends."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]).resolve()
node = sys.argv[2]
status_path = out / 'run-status.json'
started = datetime.datetime.now(datetime.timezone.utc).isoformat()

def write_status(status, **extra):
    data = dict(status=status, startedAt=started,
                updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                supervisorPid=os.getpid(), caffeinatePid=os.getppid(), **extra)
    temp = status_path.with_suffix('.next')
    temp.write_text(json.dumps(data, indent=2) + '\n')
    temp.replace(status_path)

try:
    write_status('running', stage='matches', games=168, timeMs=2000)
    subprocess.run([node, '--experimental-strip-types',
                    str(root / 'scripts/benchmark-auction-turn-match.ts'), str(out)],
                   cwd=root, check=True)
    write_status('verifying', stage='official-rule-replay-and-seed-bootstrap')
    plan = json.loads((out / 'match-plan.json').read_text())
    snapshot = Path(plan['snapshot'])
    # The frozen checker imports the frozen rules/reference beside it.
    subprocess.run([node, '--experimental-strip-types',
                    str(snapshot / 'scripts/check-auction-turn-match.ts'), str(out)],
                   cwd=root, check=True)
    result = json.loads((out / 'match-verified.json').read_text())
    assert result['games'] == 168
    assert result['status'] == 'complete-verified'
    before = json.loads((out / 'production-before.json').read_text())
    for filename, digest in before.items():
        assert hashlib.sha256((root / filename).read_bytes()).hexdigest() == digest, filename
    write_status('complete-verified', games=168,
                 verifiedActions=result['replaySteps'],
                 confidenceInterval=result['confidenceInterval'],
                 summaries=result['summaries'], productionUnchanged=True)
except BaseException as error:
    write_status('failed', error=str(error), traceback=traceback.format_exc())
    traceback.print_exc()
    raise

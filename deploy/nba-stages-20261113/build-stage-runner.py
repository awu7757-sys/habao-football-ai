"""Build the copy-and-paste Supabase function without runtime imports."""
from pathlib import Path

root = Path(__file__).resolve().parent
core = root / 'stage-core.ts'
if not core.exists():
    old = (root / 'nba-v2-stage-runner.index.txt').read_text()
    core.write_text(old.split('// Isolated NBA T-2/T-15 capture.')[0].rstrip() + '\n')
body = '\n\n'.join((root / name).read_text().rstrip() for name in (
    'stage-core.ts', 'nba-stage-context.ts', 'runner-tail.ts')) + '\n'
assert body.count('Deno.serve(') == 1
(root / 'nba-v2-stage-runner.index.txt').write_text(body)
print('Built NBA stage runner')

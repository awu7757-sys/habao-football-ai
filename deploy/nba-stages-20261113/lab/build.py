from pathlib import Path
import re,json,hashlib
root=Path(__file__).resolve().parent.parent
football=(root/'football.html').read_text()
analysis=(root/'analysis.html').read_text()
def between(a,b):return football[football.index(a):football.index(b,football.index(a))]
parts={
 'window':between('function getHabaoAnalysisWindowState(','function getHabaoAnalysisLockedText('),
 'member':between('function habaoNbaMemberResponseValid(','/* HABAO NBA: 共用足球搜尋外觀'),
 'fixtures':between('function renderBasketballFixtureData(','function renderFixtureData('),
 'selection':between('function getSelectedBatchFixtureIds()','function resetBatchAnalysisUI()'),
 'batch':between('async function startHabaoSportBatchAnalysis(){','window.addEventListener("beforeunload",event=>{'),
 'history':football[football.index('function renderAnalysisHistory('):football.index('</script>',football.index('function viewAnalysisHistory('))],
 'stages':(root/'nba-stages.js').read_text(),
 'css':'\n'.join(re.findall(r'<style[^>]*>([\s\S]*?)</style>',football)),
 'analysis':re.sub(r'<script\b[^>]*\bsrc=[^>]*>\s*</script>','',analysis),
 'demo':json.loads((root/'lab/demo.json').read_text()),
 'logos':json.loads((root/'lab/logos.json').read_text()),
 'hashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['football.html','analysis.html','nba-stages.js','nba-v2-stage-runner.index.txt']}
}
for key in ['member','batch','history','stages','analysis']:
 parts[key]=re.sub(r'window\.location\.href\s*=\s*([\s\S]*?);',r'window.__qaNavigate(\1);',parts[key])
 parts[key]=parts[key].replace('window.location.search','window.__qaSearch').replace('window.location.reload()','window.__qaNavigate("analysis.html" )')
 # No original renderer, recommendation or eligibility condition is changed.
parts['analysis']=parts['analysis'].replace('https://a.espncdn.com/i/teamlogos/nba/500/sac.png','')
encoded=json.dumps(parts,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
template=(root/'lab/shell.html').read_text()
script=(root/'lab/lab.js').read_text().replace('</script','<\\/script')
out=template.replace('__LAB_PAYLOAD__',encoded).replace('__LAB_SCRIPT__',script)
dest=root/'lab/nba-stages.html';dest.write_text(out)
print('Built isolated NBA replay page:',len(out.encode()),'bytes')

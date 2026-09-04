"""Fetch a small, curated set of individually CC BY licensed reference images."""
import urllib.request, json, re, html, concurrent.futures
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT.parent/'source-cache';CACHE.mkdir(exist_ok=True)
SLUGS=['ginkgo-biloba','nelumbo-nucifera','camellia-sinensis','salvia-rosmarinus','osmanthus-fragrans','mentha-spicata','lavandula-angustifolia','monstera-deliciosa','helianthus-annuus','ocimum-basilicum','adiantum-capillus-veneris','metasequoia-glyptostroboides']
PREF={'ginkgo-biloba':'27008','monstera-deliciosa':'Leaves Close-Up','mentha-spicata':'leaves','helianthus-annuus':'flower','nelumbo-nucifera':'14360','ocimum-basilicum':'7076'}
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.images=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='img' and re.search(r'>(CC BY (2\.0|3\.0|4\.0)|CC0)<',a.get('data-license','')):self.images.append(a)
def fetch(slug):
 url=f'https://plants.ces.ncsu.edu/plants/{slug}/'
 cache=CACHE/(slug+'.html')
 page=cache.read_text() if cache.exists() else urllib.request.urlopen(url,timeout=25).read().decode();cache.write_text(page)
 p=Parser();p.feed(page)
 candidates=p.images
 assert candidates,slug+' no suitable photo'
 preference=PREF.get(slug,'')
 if preference:candidates.sort(key=lambda a: preference.lower() not in str(a).lower())
 a=candidates[0];rawurl=a['src']; clean=rawurl.split('?')[0]
 # Public object endpoint is used; fall back to the source site's signed download if needed.
 local=ROOT/'public/assets'/(slug+Path(clean).suffix)
 if local.exists():raw=local.read_bytes()
 else:
  try: raw=urllib.request.urlopen(clean,timeout=30).read()
  except: raw=urllib.request.urlopen(rawurl,timeout=30).read()
 suffix=Path(clean).suffix
 filename=slug+suffix
 (ROOT/'public/assets'/filename).write_bytes(raw)
 return slug,{'path':'assets/'+filename,'creator':a.get('data-attrib',''),'caption':a.get('data-caption',''),'alt':a.get('alt',''),'sourceUrl':url,'originalUrl':clean,'license':re.sub('<[^>]+>','',a['data-license']),'licenseUrl':re.search("href=['\"]([^'\"]+)",a['data-license']).group(1).replace('http:','https:'),'retrievedAt':'2026-09-04','modifications':'等比例压缩与网页裁切展示'}
results={}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
 for slug,entry in ex.map(fetch,SLUGS):
  results[slug]=entry;print(slug,entry['creator'],entry['license'],flush=True)
(ROOT/'public/media.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))

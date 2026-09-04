"""Stream an extracted WFO DwC or WCVP table into a versioned local staging file.
No network requests or database writes. Missing references stay in staging for review.
"""
import argparse,csv,hashlib,json,os,sqlite3,tempfile,uuid
from pathlib import Path
from datetime import datetime,timezone

def convert(args):
 path=Path(args.input);output=Path(args.output)
 if path.resolve()==output.resolve():raise ValueError('Output must not replace input')
 if output.exists():raise ValueError('Output already exists; choose a new versioned path')
 if not args.source_url.startswith('https://') or not args.license_url.startswith('https://'):raise ValueError('Source and license URLs must use HTTPS')
 sha=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):sha.update(chunk)
 checksum=sha.hexdigest();release_id=str(uuid.uuid5(uuid.NAMESPACE_URL,f'flora:{args.format}:{args.version}'))
 fields={'wfo':{'id':'taxonID','name':'scientificName','author':'scientificNameAuthorship','rank':'taxonRank','status':'taxonomicStatus','accepted':'acceptedNameUsageID','parent':'parentNameUsageID','ipni':'ipniID'},'wcvp':{'id':'plant_name_id','name':'taxon_name','author':'taxon_authors','rank':'taxon_rank','status':'taxon_status','accepted':'accepted_plant_name_id','parent':'parent_plant_name_id','ipni':'ipni_id'}}[args.format]
 output.parent.mkdir(parents=True,exist_ok=True);temp=output.with_suffix(output.suffix+'.tmp')
 meta={'source':args.format,'version':args.version,'release_id':release_id,'source_url':args.source_url,'license_id':args.license,'license_url':args.license_url,'retrieved_at':datetime.now(timezone.utc).isoformat(),'input_sha256':checksum}
 count=0
 try:
  with tempfile.TemporaryDirectory() as td, sqlite3.connect(str(Path(td)/'ids.sqlite')) as db, path.open(encoding='utf-8-sig',newline='') as f, temp.open('w',encoding='utf-8') as out:
   db.executescript('CREATE TABLE ids(id TEXT PRIMARY KEY);CREATE TABLE refs(id TEXT,kind TEXT,target TEXT);')
   sample=f.read(16384);f.seek(0)
   delimiter=args.delimiter or ('|' if args.format=='wcvp' and '|' in sample.splitlines()[0] else '\t' if '\t' in sample.splitlines()[0] else ',')
   reader=csv.DictReader(f,delimiter=delimiter)
   required=[fields[k] for k in ['id','name','status','accepted']]
   missing=[k for k in required if k not in (reader.fieldnames or [])]
   if missing:raise ValueError('Required columns missing: '+', '.join(missing))
   for line,row in enumerate(reader,2):
    if None in row:raise ValueError(f'Line {line}: wrong number of columns')
    row={k:(v or '').strip() for k,v in row.items()}
    rid=row[fields['id']];name=row[fields['name']]
    if not rid or not name:raise ValueError(f'Line {line}: missing ID or name')
    try:db.execute('INSERT INTO ids VALUES(?)',(rid,))
    except sqlite3.IntegrityError:raise ValueError(f'Line {line}: duplicate source ID {rid}')
    def get(k):return row.get(fields[k]) or None
    record={'record_id':str(uuid.uuid5(uuid.NAMESPACE_URL,f'flora:{args.format}:{args.version}:{rid}')),'release_id':release_id,'source':args.format,'external_id':rid,'scientific_name':name,'authorship':get('author'),'taxon_rank':get('rank'),'taxonomic_status':get('status'),'accepted_external_id':get('accepted'),'parent_external_id':get('parent'),'family_name':row.get('family') or None,'genus_name':row.get('genus') or None,'ipni_id':get('ipni'),'original_row':row}
    for kind in ['accepted','parent']:
     if get(kind):db.execute('INSERT INTO refs VALUES(?,?,?)',(rid,kind,get(kind)))
    out.write(json.dumps(record,ensure_ascii=False)+'\n');count+=1
    if count%10000==0:db.commit()
   missing_count=db.execute('SELECT count(*) FROM refs LEFT JOIN ids ON refs.target=ids.id WHERE ids.id IS NULL').fetchone()[0]
   samples=db.execute('SELECT refs.id,refs.kind,refs.target FROM refs LEFT JOIN ids ON refs.target=ids.id WHERE ids.id IS NULL LIMIT 20').fetchall()
   meta.update(record_count=count,unresolved_reference_count=missing_count,unresolved_reference_examples=samples,ready_for_relationship_validation=missing_count==0,scope='staging-only')
  os.replace(temp,output)
  output.with_suffix(output.suffix+'.metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
  return meta
 except:
  temp.unlink(missing_ok=True);raise

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('--format',choices=['wfo','wcvp'],required=True);p.add_argument('--version',required=True);p.add_argument('--source-url',required=True);p.add_argument('--license',required=True);p.add_argument('--license-url',required=True);p.add_argument('--output',required=True);p.add_argument('--delimiter')
 a=p.parse_args()
 try:print(json.dumps(convert(a),ensure_ascii=False,indent=2))
 except (ValueError,csv.Error,UnicodeError,OSError) as e:p.exit(1,str(e)+'\n')

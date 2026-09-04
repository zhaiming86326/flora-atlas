import unittest,tempfile,argparse,importlib.util,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('importer',Path(__file__).resolve().parents[1]/'scripts/import-taxonomy.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ImporterTests(unittest.TestCase):
 def run_case(self,text,fmt='wcvp'):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name);source=root/'input.txt';source.write_text(text)
  args=argparse.Namespace(input=str(source),format=fmt,version='test1',source_url='https://example.org/source',license='CC0-1.0',license_url='https://creativecommons.org/publicdomain/zero/1.0/',output=str(root/'result.jsonl'),delimiter=None)
  result=mod.convert(args);return result,[json.loads(s) for s in Path(args.output).read_text().splitlines()]
 def test_wcvp_names_and_accepted_self(self):
  m,r=self.run_case('plant_name_id|taxon_name|taxon_status|accepted_plant_name_id|taxon_authors\n1|Salvia rosmarinus|Accepted|1|Spenn.\n2|Rosmarinus officinalis|Synonym|1|L.\n');self.assertEqual(m['record_count'],2);self.assertEqual(m['unresolved_reference_count'],0);self.assertEqual(r[0]['accepted_external_id'],'1');self.assertIsNone(r[0]['parent_external_id']);self.assertNotEqual(r[0]['record_id'],r[1]['record_id'])
 def test_wfo_unresolved_relationship_reported(self):
  m,r=self.run_case('taxonID\tscientificName\ttaxonomicStatus\tacceptedNameUsageID\tparentNameUsageID\nwfo-1\tGinkgo biloba\taccepted\twfo-1\twfo-2\n','wfo');self.assertEqual(m['unresolved_reference_count'],1);self.assertFalse(m['ready_for_relationship_validation'])
 def test_duplicate_or_missing_columns_rejected(self):
  with self.assertRaises(ValueError):self.run_case('plant_name_id|taxon_name|taxon_status|accepted_plant_name_id\n1|A b|Accepted|1\n1|C d|Accepted|1\n')
  with self.assertRaises(ValueError):self.run_case('id|name\n1|hello\n')
if __name__=='__main__':unittest.main()

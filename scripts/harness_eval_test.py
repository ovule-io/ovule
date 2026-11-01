import unittest
from harness_eval import aggregate, regressions, run_adapter
import tempfile
import sys
from pathlib import Path

class EvaluationTests(unittest.TestCase):
    def test_observed_trials_and_skips_are_not_success(self):
        summary = aggregate([{"cases":[{"id":"a","status":"pass","duration_ms":1}]},
                             {"cases":[{"id":"a","status":"skip","duration_ms":0}]}])
        self.assertTrue(summary[0]["success_at_k"])
        self.assertFalse(summary[0]["all_of_k"])
        self.assertEqual(summary[0]["p95_ms"],1)
        self.assertEqual(regressions(summary,[{"id":"a","all_of_k":True}]),["a"])
    def test_new_case_has_no_invented_baseline(self):
        self.assertEqual(regressions([{"id":"new","all_of_k":False}],[]),[])
    def test_failure_and_percentiles(self):
        values=aggregate([{"cases":[{"id":"a","status":status,"duration_ms":ms}]} for status,ms in [("pass",1),("fail",3),("pass",8)]])[0]
        self.assertEqual((values["p50_ms"],values["p95_ms"],values["failed"]),(3,8,1))

    def test_missing_report_fails_every_expected_case(self):
        with tempfile.TemporaryDirectory() as root:
            report=run_adapter([sys.executable,"-c","pass"],Path(root)/"report.json",10,["one","two"])
            self.assertEqual([case["status"] for case in report["cases"]],["fail","fail"])
    def test_duplicate_or_missing_case_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/"report.json"
            path.write_text('{"schema_version":1,"cases":[{"id":"one","status":"pass","duration_ms":1}]}')
            report=run_adapter([sys.executable,"-c","pass"],path,10,["one","two"])
            self.assertTrue(all(case["status"]=="fail" for case in report["cases"]))

if __name__ == '__main__': unittest.main()

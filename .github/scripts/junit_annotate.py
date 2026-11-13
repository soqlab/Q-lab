"""Print one GitHub Actions error annotation per failed or errored test in a JUnit XML report."""
import os
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1] if len(sys.argv) > 1 else "junit.xml"
if not os.path.exists(path):
    print("::error title=No test report::pytest did not write a report (it stopped before or during collection)")
    raise SystemExit(0)
for case in ET.parse(path).iter("testcase"):
    for bad in list(case.findall("failure")) + list(case.findall("error")):
        msg = " ".join((bad.get("message") or bad.text or "").split())[:900]
        print(f"::error title={case.get('classname')}.{case.get('name')}::{msg}")

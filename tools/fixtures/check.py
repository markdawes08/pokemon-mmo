"""Check stored canonical bytes and deterministic compression, without engine code."""
from copy import deepcopy
import json
from fixture_io import ROOT, compress_fixture, decode_fixture, fixture_entries, read_fixture_bytes, read_fixture_text

rows = fixture_entries()
for row in rows:
    assert not (ROOT / row["path"]).exists(), "Registered fixture has a stale plain JSON copy"
    data = read_fixture_bytes(ROOT / row["path"])
    fixture = json.loads(data)
    assert row["sourcePaths"] == sorted({record["path"] for record in fixture["sourceRecords"]})
    cases = [case for name in row["caseCollections"] for case in fixture[name]]
    assert len(cases) == row["cases"]
    assert len({case["id"] for case in cases}) == len(cases)
    assert b"\n" not in data.replace(b"\r\n", b"")
    assert read_fixture_text(ROOT / row["path"]) == data.decode("utf-8").replace("\r\n", "\n")
    archive = (ROOT / row["archive"]).read_bytes()
    assert compress_fixture(data) == archive == compress_fixture(data)

first = rows[0]
archive = (ROOT / first["archive"]).read_bytes()
bad_hash = deepcopy(first); bad_hash["canonicalSha256"] = "0" * 64
too_small = deepcopy(first); too_small["canonicalBytes"] -= 1
for damaged, entry in [(archive[1:], first), (archive[:-1] + bytes([archive[-1] ^ 1]), first),
                       (archive, bad_hash), (archive, too_small)]:
    try:
        decode_fixture(damaged, entry)
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid fixture accepted")
try:
    read_fixture_bytes(ROOT / "tools/battle-unknown/fixtures/source-cases.json")
except ValueError:
    pass
else:
    raise AssertionError("Unknown fixture accepted")
result = dict(status="passed", scope="Canonical fixture storage only; no mechanics verification",
              archives=len(rows), cases=sum(row["cases"] for row in rows),
              canonicalBytes=sum(row["canonicalBytes"] for row in rows),
              archiveBytes=sum(row["archiveBytes"] for row in rows), rejectionChecks=5,
              fixtures=[dict(path=row["path"], canonicalSha256=row["canonicalSha256"]) for row in rows])
(ROOT / "reports/fixture-storage-python.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(result))

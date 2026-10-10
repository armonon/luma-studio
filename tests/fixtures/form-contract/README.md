# Form mesh contract

`luma-mesh-asset.ts` is unmodified source from the Form repository/commit/path
in `provenance.json`, retrieved with `git show`. It is required in every standalone
Luma test run. Its SHA-256 and byte parity with the real Luma implementation are
checked; a missing fixture, hash mismatch or contract change fails the test.
This verifies compatibility with **that pinned Form version**, not whatever
Form may deploy later. It is not a mock or a generated expected value.

For an explicit current Form checkout, also run:

```sh
LUMA_FORM_CONTRACT_SOURCE=/path/to/form/app/luma-mesh-asset.ts npm test
```

An explicitly supplied missing or divergent path fails rather than skipping.
When intentionally updating the shared contract, retrieve the actual source from
a reviewed Form commit, update the provenance commit/hash, and run both apps'
exchange suites. Do not overwrite the fixture from Luma to make a failure pass.

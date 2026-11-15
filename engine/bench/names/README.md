# Names bench

`bench.py` runs `PresidioDetector.scan` with the policy's types over the 250 synthetic records in `test.jsonl`, all fake, split as the research harness splits them. `--detector spacy` rebuilds today's baseline, where spaCy reports PERSON. Leak and over-redaction count only spans at tier 2 and up, the ones the policy acts on. Quality numbers are deterministic. Times are the median of 3 alternating runs per detector on an 8-core Mac CPU, at load average 3.

| Detector | Split | PERSON F1 | Precision | Recall | Leak rate | Over-redaction | F1 public-figure | False flags public-figure | Median ms | p90 ms |
|---|---|---|---|---|---|---|---|---|---|---|
| spaCy (before) | test_dev | 0.426 | 0.396 | 0.462 | 0.505 | 0.357 | 0.118 | 29 | 7 | 12 |
| GLiNER2 (after) | test_dev | 0.957 | 0.937 | 0.978 | 0.000 | 0.143 | 0.857 | 1 | 177 | 214 |
| spaCy (before) | test_final | 0.500 | 0.564 | 0.449 | 0.520 | 0.273 | 0.182 | 9 | 7 | 11 |
| GLiNER2 (after) | test_final | 0.903 | 0.907 | 0.898 | 0.082 | 0.167 | 0.000 | 0 | 179 | 236 |

`demo/data/employees.csv` (877 characters), median of 20 scans after 2 warmups: 27 ms with spaCy, 510 ms with GLiNER2 (range of the three run medians 405 to 565 ms). On test_final, the one private name in a public-figure record is missed and no famous name is flagged, so that F1 is 0.

```sh
.venv/bin/python -m bench.names.bench
.venv/bin/python -m bench.names.bench --detector spacy
```

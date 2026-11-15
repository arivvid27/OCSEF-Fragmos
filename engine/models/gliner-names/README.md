# gliner-names

A LoRA adapter (r16, alpha 32) for `fastino/gliner2-privacy-filter-PII-multi` at revision `1cb4166094dc58fa8d836429f060d6c95f62b495`. It finds the names of private people and passes over famous and historical figures. SENTINEL uses it for `PERSON` only.

Trained for 10 epochs, seed 42 (run `it3-ep10-s42`, `final` checkpoint), on 1,676 synthetic records. All training and test data is generated and fake.

On the engine's bench (`bench/names/`), PERSON exact-span F1 is 0.957 on test_dev and 0.903 on test_final, against 0.426 and 0.500 for spaCy. The research harness scored 0.945 on test_dev without joining spaced-out letters.

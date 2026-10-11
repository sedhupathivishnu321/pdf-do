# Benchmark results (measured)

Environment: python=3.11.15, platform=Windows-10-10.0.26200-SP0, cpu=AMD64 Family 23 Model 96 Stepping 1, AuthenticAMD, cores=12, ram_gb=8.0, pymupdf=1.28.2, docx=1.2.0, jiwer=?, pdf2docx=0.5.13, tesseract=5.4.0.20240606

| document | tool | ok | pages | WER | CER | table F1 | layout err % width | page ratio | seconds | peak MB |
|---|---|---|---|---|---|---|---|---|---|---|
| text | ours | yes | 3 | 0.0 | 0.0 | - | 2.03 | 1.0 | 2.79 | 92.2 |
| text | pdf2docx | yes | 3 | 0.0082 | 0.004 | - | 0.31 | 1.0 | 1.23 | 88.0 |
| twocol | ours | yes | 2 | 0.0 | 0.0 | - | 2.8 | 1.0 | 3.38 | 98.5 |
| twocol | pdf2docx | yes | 2 | 0.4031 | 0.3882 | - | 0.44 | 1.0 | 1.26 | 88.9 |
| tables | ours | yes | 1 | 0.0 | 0.0 | 1.0 | 7.61 | 1.0 | 1.21 | 86.0 |
| tables | pdf2docx | yes | 1 | 0.0 | 0.0 | 1.0 | 0.34 | 1.0 | 1.25 | 84.5 |
| scanned | ours | yes | 2 | 0.0264 | 0.0116 | - | - | - | 17.79 | 197.8 |
| scanned | pdf2docx | yes | 2 | 1.0 | 1.0 | - | - | - | 2.93 | 122.9 |
| mixed | ours | yes | 2 | 0.0163 | 0.0077 | - | 4.22 | 1.0 | 10.46 | 183.8 |
| mixed | pdf2docx | yes | 2 | 0.5 | 0.5001 | - | 0.31 | 1.0 | 3.15 | 117.4 |

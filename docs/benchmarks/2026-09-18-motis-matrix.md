# v0.6.1 MOTIS regional matrix — 2026-09-18

## Execution plan

1. Test unique OD enumeration, bounded concurrent scheduling, cancellation, latency aggregation, and coherent multi-route GTFS merging.
2. Build a timetable-only synthetic schedule on actual Yeosu ROUTESTTN regional routes. Preserve physical stop IDs; Before uses 20-minute headway, After 15-minute headway. This measures timetable routing, not OSM access walking or observed transit performance.
3. Smoke-test a small matrix, then run 100 unique origins × 100 unique destinations × 24 hourly departures × Before/After (480,000 HTTP calls), with fixed concurrency, streaming JSONL, exact counters, and periodic process measurements.
4. Record measured wall time, throughput, latency, response/storage bytes, client and MOTIS CPU/RAM separately, failures and no-route outcomes. Decide whether evidence warrants R5 without inventing a performance SLA.

Status: implementation and measurements complete for the documented timetable-only regional workload.

## Method and interpretation notes

- Actual file is mixed-region ROUTESTTN. Only route IDs beginning `460` (Yeosu) are selected: 77 routes, 1,611 physical stop IDs. One canonical name/coordinate definition is used per shared stop; each route preserves its ordered stop sequence, including repeat visits.
- 200 evenly spaced IDs in sorted regional stop IDs are split into disjoint sets of 100 origins and 100 destinations. Thus no self-OD requests occur. Departures are every hour 00:00 through 23:00 on 2026-09-18. Import `first_day` is pinned to that date for reproducibility across midnight.
- Each Before and After package coherently merges agency, stop, route, service/calendar, trip and stop-time tables. Trip IDs are keyed by `trip_id`; stop times by trip and sequence. Conflicting definitions fail. Per-route JSON metadata is excluded from GTFS CSV merging.
- Fixed concurrency 8, no automatic retries, 30-second request deadline. Exact per-call compact journey outcomes are streamed to JSONL with backpressure; raw HTTP bytes are counted but full HTTP payloads are not retained. A fixed 60,002-bin latency histogram reports P90 rounded upward to the next millisecond. Outcome records use `totalSeconds: null` for no-route; they are not interpreted as zero-minute journeys.
- Ctrl+C/SIGTERM or creation of a `CANCEL` file in the printed run directory cancels in-flight requests and stops scheduling. Already-started canceled requests appear as errors; report includes cancellation status and actual completion count.
- MOTIS starts once per package on its own ephemeral loopback port. No shared 8080 server is used. The server is restarted between packages; OS caches are not flushed and no warm-up calls are excluded.
- Setup time reports config/import/server readiness, excluding GTFS synthesis/compression. Matrix wall time includes measurement/sink flush/shutdown overhead. HTTP latency includes response body parsing/normalization; it excludes JSONL sink backpressure. CPU 100% means one logical core, and can exceed 100% on this 16-thread CPU. Working set and CPU are sampled approximately every five seconds using the specific sidecar PID; the runner's RSS/CPU is separate. Sampled peaks can miss shorter peaks. Sampling PowerShell overhead affects measured wall time but is not counted as runner/sidecar CPU.
- A parent build ran for approximately 15 seconds during the early Before segment. This is disclosed resource contention; these are observed workstation timings, not an isolated microbenchmark.
- Timetable-only baseline uses synthetic service assumptions and MOTIS timetable transfers. It does not establish road-network access/egress performance, production network coverage, demand realism, UI responsiveness, or repeat-run stability.

## Reproduction

`npx vite-node --script scripts/benchmark-motis-matrix.mts --smoke` runs 3 × 3 × 2 × 2 = 36 calls. Omit `--smoke` for 480,000 calls. Environment overrides: `MOTIS_MATRIX_SOURCE`, `MOTIS_EXECUTABLE_PATH`, `MOTIS_MATRIX_CONCURRENCY` (integer 1–64; default 8). Each run prints a fresh artifact directory and progress every five seconds.

The full run resumed on 2026-09-19 KST, retaining the 2026-09-18 service date. The earlier small run completed 36/36 with no errors or no-route responses. Its three-stop sample is only a smoke check, not the large-network result.

## 실측 결과

실행 증빙은 `test-artifacts/motis-matrix/2026-09-18T16-44-29-697Z/report.json`이다. 각 패키지는 100개 origin × 100개 destination × 24개 출발시각 = 240,000건이며, Before/After 합계는 480,000건이다. 두 패키지 모두 240,000건을 완료했고 HTTP 오류는 0건, 무경로는 72건이었다. 무경로는 오류나 0분 소요로 합산하지 않고 별도 결과로 기록했다.

| 패키지 | 완료 | 무경로 | 벽시계 | 처리량 | 평균 지연 | P90 상한 | 응답 바이트 | 결과 JSONL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Before | 240,000/240,000 | 72 | 306.08s | 784.1 OD/s | 10.17ms | 13ms | 9.62GB | 230.84MB |
| After | 240,000/240,000 | 72 | 839.68s | 285.8 OD/s | 27.96ms | 46ms | 10.58GB | 234.83MB |

클라이언트 최대 RSS는 Before 약 0.96GiB, After 약 1.24GiB였다. MOTIS 샘플 최대 working set은 각각 약 84.3MiB와 89.5MiB였고, 샘플링된 최대 CPU는 각각 약 569.4%와 580.3%(100% = 논리 코어 1개)였다. Before 초반 약 15초에는 별도 패키지 빌드가 겹쳤으므로 이 수치는 현재 장비에서의 관측값이며 격리된 성능 보증이나 R5 SLA가 아니다. 이번 결과는 도로망 접근성, 실측 수요, UI 응답성 또는 반복 실행 안정성을 측정하지 않는다.

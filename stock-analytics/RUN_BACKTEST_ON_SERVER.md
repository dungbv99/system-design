# Chạy Wyckoff-Optimized Backtest trên Server

Mục tiêu: chạy walk-forward backtest (2014–2025) trên server → sinh ra bộ params tối ưu mới
và 2 file kết quả trong `stock-analytics/output/`.

Sau khi xong, **gửi lại 2 file**:
- `output/backtest_results_<ts>.json`  ← để phân tích (BẮT BUỘC)
- `output/backtest_insert_<ts>.sql`    ← để insert params vào DB local (kèm cho chắc)

> ⚠️ Backtest cần **dữ liệu giá VN100 + VNINDEX (2014–2025)** có sẵn trong DB của server.
> Bước 3 lo việc này. Nếu server đã có dữ liệu rồi thì bỏ qua bước 3.

---

## 0. Yêu cầu trên server
- Docker + Docker Compose
- Git
- ~vài GB trống cho dữ liệu + snapshot cache

---

## 1. Lấy code mới
```bash
cd <thư-mục-project>/system-design      # nơi chứa repo
git pull
```

## 2. Khởi động dịch vụ (build lại image vì có code mới)
```bash
cd system-design
make build-stock        # build image crawler + frontend với code mới
make run-stock          # chạy postgres + crawler (+ frontend)
docker compose -f stock-analytics/docker-compose.yml ps   # kiểm tra đều "running"
```

## 3. Nạp dữ liệu giá vào DB server

### Cách A — Copy dữ liệu từ máy local sang (KHUYẾN NGHỊ, nhanh)
Chạy **trên máy local** (nơi đã có đủ dữ liệu) để xuất DB:
```bash
cd system-design
docker compose -f stock-analytics/docker-compose.yml exec -T postgres \
  pg_dump -U postgres -d stock --clean --if-exists > /tmp/stock_dump.sql
```
Copy file sang server:
```bash
scp /tmp/stock_dump.sql <user>@<server>:/tmp/stock_dump.sql
```
Rồi **trên server** nạp vào DB:
```bash
cd system-design
docker compose -f stock-analytics/docker-compose.yml exec -T postgres \
  psql -U postgres -d stock < /tmp/stock_dump.sql
```

### Cách B — Crawl dữ liệu mới trên server (chậm hơn nhiều)
Cần `FIREANT_TOKEN` trong `stock-analytics/docker-compose.yml`, sau đó:
```bash
make crawl-now          # crawl symbols + lịch sử (mất thời gian cho full history)
```

## 4. Đánh dấu rổ VN100 (idempotent — chạy lại vô hại)
```bash
make mark-vn100
```

## 5. Kiểm tra dữ liệu đã sẵn sàng
```bash
docker exec stock-analytics-crawler-1 python3 -c \
"import os; from store import Store; s=Store(os.environ['DB_DSN']); \
 q=s.get_symbol_quotes('VNINDEX', days=99999); \
 print('VNINDEX bars:', len(q), '| first:', q[0]['date'] if q else None, '-> last:', q[-1]['date'] if q else None); \
 print('VN100 symbols:', len(s.get_vn100_symbols()))"
```
Kỳ vọng: VNINDEX có vài nghìn bars trải từ ~2014 → 2025, và VN100 ~100 mã.
Nếu VNINDEX trống → quay lại bước 3.

## 6. Chạy backtest

```bash
# Full — 1000 mẫu, ~2-6h (kết quả tốt nhất)
make backtest

# HOẶC nhẹ/nhanh để thử trước — 100 mẫu, ~30-60 phút
make backtest-quick
```
Lần chạy ĐẦU sẽ build snapshot (~1.5h) vì vừa đổi cache — các lần sau dùng cache.

> Chạy nền cho an toàn khi mất kết nối SSH:
> ```bash
> nohup make backtest > stock-analytics/output/run.out 2>&1 &
> tail -f stock-analytics/output/run.out
> ```

## 7. Theo dõi tiến độ (tab/cửa sổ khác)
```bash
make backtest-progress
# hoặc xem log:
tail -f stock-analytics/output/backtest_*.log
```

## 8. Khi chạy xong — lấy file kết quả
```bash
ls -lh stock-analytics/output/
# Sẽ thấy:
#   backtest_results_<ts>.json   <- GỬI cho Claude (phân tích)
#   backtest_insert_<ts>.sql     <- để insert params vào DB local
#   optimized_params.json        <- params per-regime (tham khảo)
#   backtest_<ts>.log            <- log chạy
```
Copy 2 file về máy local:
```bash
scp <user>@<server>:'<đường-dẫn>/system-design/stock-analytics/output/backtest_results_*.json' .
scp <user>@<server>:'<đường-dẫn>/system-design/stock-analytics/output/backtest_insert_*.sql' .
```

---

## 9. (Làm sau, trên máy LOCAL) Nạp params mới vào DB local
Sau khi tôi xác nhận kết quả ổn:
```bash
cd system-design
docker compose -f stock-analytics/docker-compose.yml exec -T postgres \
  psql -U postgres -d stock < backtest_insert_<ts>.sql
```
- Phần `optimized_params` dùng UPSERT → chạy lại an toàn.
- Phần `backtest_runs/trades` là append → đừng chạy 2 lần nếu không muốn trùng lịch sử.

---

## Tham khảo nhanh — toàn bộ lệnh chính (server, sau khi đã có dữ liệu)
```bash
cd system-design
git pull
make build-stock && make run-stock
make mark-vn100
make backtest                 # ~2-6h
ls -lh stock-analytics/output/    # lấy *.json và *.sql
```

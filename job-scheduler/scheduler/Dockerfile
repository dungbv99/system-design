FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY main.go .
RUN go mod tidy && go build -o service .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/service .
CMD ["./service"]

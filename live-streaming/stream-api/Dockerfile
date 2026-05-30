FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -o stream-api .

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/stream-api .
EXPOSE 8082
ENTRYPOINT ["./stream-api"]

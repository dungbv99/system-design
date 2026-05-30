FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -o sync-gateway .

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/sync-gateway .
EXPOSE 8081
ENTRYPOINT ["./sync-gateway"]

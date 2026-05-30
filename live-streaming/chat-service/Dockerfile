FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -o chat-service .

FROM alpine:3.19
WORKDIR /app
COPY --from=build /app/chat-service .
EXPOSE 8083
ENTRYPOINT ["./chat-service"]

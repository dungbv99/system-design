FROM maven:3.9-eclipse-temurin-17-alpine AS build
WORKDIR /workspace
# Copy parent POM first (build context is repo root)
COPY pom.xml .
COPY file-storage/pom.xml file-storage/pom.xml
RUN mvn dependency:go-offline -pl file-storage -am -q
COPY file-storage/src file-storage/src
RUN mvn package -pl file-storage -DskipTests -q

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /workspace/file-storage/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]

package org.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.example.config.AppProperties;

@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
public class FilestorageApplication {
    public static void main(String[] args) {
        SpringApplication.run(FilestorageApplication.class, args);
    }
}

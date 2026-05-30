package org.example.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;
import java.sql.*;

/**
 * Custom DataSource configuration that auto-creates the 'filestorage' database
 * before Flyway runs. This bean is created first (Flyway depends on DataSource),
 * so database creation is guaranteed before any migration.
 *
 * Overrides Spring Boot's auto-configured DataSource via @Primary.
 */
@Slf4j
@Configuration
public class DatabaseConfig {

    @Value("${spring.datasource.url}")
    private String url;

    @Value("${spring.datasource.username}")
    private String username;

    @Value("${spring.datasource.password}")
    private String password;

    @Bean
    @Primary
    public DataSource dataSource() {
        ensureDatabaseExists();

        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(url);
        cfg.setUsername(username);
        cfg.setPassword(password);
        cfg.setMaximumPoolSize(20);
        cfg.setMinimumIdle(2);
        cfg.setConnectionTimeout(30_000);
        cfg.setPoolName("FilestoragePool");
        return new HikariDataSource(cfg);
    }

    /**
     * Connect to the 'postgres' admin database and CREATE DATABASE filestorage
     * if it does not already exist.
     */
    private void ensureDatabaseExists() {
        // Swap the target DB name to 'postgres' to connect as admin
        String adminUrl = url.replaceFirst("/(filestorage)(\\?.*)?$", "/postgres$2");
        log.info("Checking if 'filestorage' database exists...");
        try (Connection conn = DriverManager.getConnection(adminUrl, username, password);
             Statement stmt = conn.createStatement()) {

            try (ResultSet rs = stmt.executeQuery(
                    "SELECT 1 FROM pg_database WHERE datname = 'filestorage'")) {
                if (!rs.next()) {
                    stmt.execute("CREATE DATABASE filestorage");
                    log.info("✓ Database 'filestorage' created automatically");
                } else {
                    log.info("✓ Database 'filestorage' already exists");
                }
            }
        } catch (SQLException e) {
            log.warn("Could not auto-create 'filestorage': {} — " +
                     "Please run: psql -U postgres -c \"CREATE DATABASE filestorage;\"",
                     e.getMessage());
        }
    }
}

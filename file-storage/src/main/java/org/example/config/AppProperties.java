package org.example.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private Jwt jwt = new Jwt();
    private Storage storage = new Storage();
    private Upload upload = new Upload();

    @Getter @Setter
    public static class Jwt {
        private String secret;
        private long expirationMs = 86400000L;
    }

    @Getter @Setter
    public static class Storage {
        private String blocksPath = "./blocks";
    }

    @Getter @Setter
    public static class Upload {
        private int maxBlockSize = 8 * 1024 * 1024;
        private int minBlockSize = 512 * 1024;
        private int sessionExpiryHours = 24;
        private int maxVersionsPerFile = 100;
    }
}

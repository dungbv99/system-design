package org.example.service;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.example.config.AppProperties;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.*;

/**
 * Local filesystem block store.
 * Layout: {blocksPath}/{hash[0:2]}/{hash}
 * Blocks are content-addressed and immutable — safe to cache forever.
 */
@Slf4j
@Service
public class StorageService {

    private final Path blocksRoot;

    public StorageService(AppProperties props) {
        this.blocksRoot = Paths.get(props.getStorage().getBlocksPath()).toAbsolutePath();
    }

    @PostConstruct
    public void init() throws IOException {
        Files.createDirectories(blocksRoot);
        log.info("Block storage root: {}", blocksRoot);
    }

    /** Persist block bytes to disk (idempotent). */
    public void store(String hash, byte[] data) {
        try {
            Path path = blockPath(hash);
            Files.createDirectories(path.getParent());
            // REPLACE so identical concurrent uploads converge safely
            Files.write(path, data,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to store block " + hash, e);
        }
    }

    /** Load block bytes from disk. */
    public byte[] load(String hash) {
        try {
            Path path = blockPath(hash);
            if (!Files.exists(path)) {
                throw new NoSuchFileException("Block not found: " + hash);
            }
            return Files.readAllBytes(path);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to load block " + hash, e);
        }
    }

    public boolean exists(String hash) {
        return Files.exists(blockPath(hash));
    }

    /** Delete block from disk (called after ref_count drops to 0). */
    public void delete(String hash) {
        try {
            Files.deleteIfExists(blockPath(hash));
        } catch (IOException e) {
            log.warn("Could not delete block {}: {}", hash, e.getMessage());
        }
    }

    private Path blockPath(String hash) {
        // Two-level sharding: e.g. blocks/ab/abcdef123...
        return blocksRoot.resolve(hash.substring(0, 2)).resolve(hash);
    }
}

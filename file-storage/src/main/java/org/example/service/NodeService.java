package org.example.service;

import lombok.RequiredArgsConstructor;
import org.example.dto.request.CreateFolderRequest;
import org.example.dto.request.MoveNodeRequest;
import org.example.dto.response.NodeResponse;
import org.example.exception.AppException;
import org.example.model.FileNode;
import org.example.model.FileVersion;
import org.example.repository.FileNodeRepository;
import org.example.repository.FileVersionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class NodeService {

    private final FileNodeRepository nodeRepo;
    private final FileVersionRepository versionRepo;
    private final SyncService syncService;

    // ----------------------------------------------------------------
    //  Listing
    // ----------------------------------------------------------------

    public List<NodeResponse> listRoot(String userId) {
        return nodeRepo.findByOwnerIdAndParentIdIsNullAndDeletedFalse(userId)
                .stream().map(n -> toResponse(n, latestVersion(n))).toList();
    }

    public List<NodeResponse> listChildren(String userId, String parentId) {
        // Verify parent belongs to user
        nodeRepo.findByIdAndOwnerIdAndDeletedFalse(parentId, userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Folder not found"));
        return nodeRepo.findByOwnerIdAndParentIdAndDeletedFalse(userId, parentId)
                .stream().map(n -> toResponse(n, latestVersion(n))).toList();
    }

    public NodeResponse getNode(String userId, String nodeId) {
        FileNode node = requireNode(userId, nodeId);
        return toResponse(node, latestVersion(node));
    }

    // ----------------------------------------------------------------
    //  Mutations
    // ----------------------------------------------------------------

    @Transactional
    public NodeResponse createFolder(String userId, CreateFolderRequest req) {
        if (req.getParentId() != null) {
            nodeRepo.findByIdAndOwnerIdAndDeletedFalse(req.getParentId(), userId)
                    .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Parent folder not found"));
        }
        FileNode node = new FileNode();
        node.setOwnerId(userId);
        node.setParentId(req.getParentId());
        node.setName(req.getName());
        node.setNodeType("folder");
        node = nodeRepo.save(node);

        syncService.appendLog(userId, node.getId(), null, "create", null,
                "{\"name\":\"" + node.getName() + "\",\"type\":\"folder\"}");

        return toResponse(node, null);
    }

    /** Creates a file node (called by UploadService before starting an upload). */
    @Transactional
    public FileNode createFileNode(String userId, String parentId, String name) {
        if (parentId != null) {
            nodeRepo.findByIdAndOwnerIdAndDeletedFalse(parentId, userId)
                    .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Parent folder not found"));
        }
        FileNode node = new FileNode();
        node.setOwnerId(userId);
        node.setParentId(parentId);
        node.setName(name);
        node.setNodeType("file");
        return nodeRepo.save(node);
    }

    @Transactional
    public NodeResponse moveOrRename(String userId, String nodeId, MoveNodeRequest req) {
        FileNode node = requireNode(userId, nodeId);
        if (req.getName() != null && !req.getName().isBlank()) {
            node.setName(req.getName());
        }
        if (req.getParentId() != null && !"SAME".equals(req.getParentId())) {
            if (!req.getParentId().isEmpty()) {
                nodeRepo.findByIdAndOwnerIdAndDeletedFalse(req.getParentId(), userId)
                        .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Target folder not found"));
            }
            node.setParentId(req.getParentId().isEmpty() ? null : req.getParentId());
        }
        node = nodeRepo.save(node);

        syncService.appendLog(userId, node.getId(), null, "move", null,
                "{\"name\":\"" + node.getName() + "\"}");

        return toResponse(node, latestVersion(node));
    }

    @Transactional
    public void deleteNode(String userId, String nodeId) {
        FileNode node = requireNode(userId, nodeId);
        node.setDeleted(true);
        nodeRepo.save(node);
        syncService.appendLog(userId, nodeId, null, "delete", null, "{}");
    }

    // ----------------------------------------------------------------
    //  Helpers
    // ----------------------------------------------------------------

    private FileNode requireNode(String userId, String nodeId) {
        return nodeRepo.findByIdAndOwnerIdAndDeletedFalse(nodeId, userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Node not found"));
    }

    private FileVersion latestVersion(FileNode node) {
        if (!"file".equals(node.getNodeType())) return null;
        return versionRepo.findByNodeIdOrderByVersionNumberDesc(node.getId())
                .stream().findFirst().orElse(null);
    }

    NodeResponse toResponse(FileNode node, FileVersion version) {
        return NodeResponse.builder()
                .id(node.getId())
                .parentId(node.getParentId())
                .name(node.getName())
                .nodeType(node.getNodeType())
                .sizeBytes(version != null ? version.getSizeBytes() : 0)
                .contentHash(version != null ? version.getContentHash() : null)
                .versionNumber(version != null ? version.getVersionNumber() : 0)
                .createdAt(node.getCreatedAt())
                .updatedAt(node.getUpdatedAt())
                .build();
    }
}

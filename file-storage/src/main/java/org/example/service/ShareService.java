package org.example.service;

import lombok.RequiredArgsConstructor;
import org.example.dto.request.CreateShareRequest;
import org.example.dto.response.ShareResponse;
import org.example.exception.AppException;
import org.example.model.FileNode;
import org.example.model.Share;
import org.example.model.User;
import org.example.repository.FileNodeRepository;
import org.example.repository.ShareRepository;
import org.example.repository.UserRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ShareService {

    private final ShareRepository shareRepo;
    private final FileNodeRepository nodeRepo;
    private final UserRepository userRepo;

    // ----------------------------------------------------------------
    //  Create share
    // ----------------------------------------------------------------

    @Transactional
    public ShareResponse createShare(String userId, CreateShareRequest req) {
        FileNode node = nodeRepo.findByIdAndOwnerIdAndDeletedFalse(req.getNodeId(), userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Node not found"));

        Share share = new Share();
        share.setNodeId(node.getId());
        share.setOwnerId(userId);
        share.setShareType(req.getShareType());
        share.setPermission(req.getPermission() != null ? req.getPermission() : "read");

        if ("user".equals(req.getShareType())) {
            if (req.getGranteeEmail() == null) {
                throw new AppException(HttpStatus.BAD_REQUEST, "granteeEmail required for user share");
            }
            User grantee = userRepo.findByEmail(req.getGranteeEmail())
                    .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Grantee user not found"));
            share.setGranteeId(grantee.getId());
        } else if ("link".equals(req.getShareType())) {
            share.setToken(UUID.randomUUID().toString().replace("-", ""));
        } else {
            throw new AppException(HttpStatus.BAD_REQUEST, "shareType must be 'user' or 'link'");
        }

        if (req.getExpiresAt() != null) {
            share.setExpiresAt(Instant.parse(req.getExpiresAt()));
        }

        share = shareRepo.save(share);
        return toResponse(share, node);
    }

    // ----------------------------------------------------------------
    //  List
    // ----------------------------------------------------------------

    public List<ShareResponse> listMyShares(String userId) {
        return shareRepo.findByOwnerId(userId).stream()
                .map(s -> {
                    FileNode node = nodeRepo.findById(s.getNodeId()).orElse(null);
                    return toResponse(s, node);
                }).toList();
    }

    public List<ShareResponse> listReceivedShares(String userId) {
        return shareRepo.findByGranteeId(userId).stream()
                .map(s -> {
                    FileNode node = nodeRepo.findById(s.getNodeId()).orElse(null);
                    return toResponse(s, node);
                }).toList();
    }

    // ----------------------------------------------------------------
    //  Access by token (public link)
    // ----------------------------------------------------------------

    public ShareResponse accessByToken(String token) {
        Share share = shareRepo.findByToken(token)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Share link not found"));
        if (share.getExpiresAt() != null && Instant.now().isAfter(share.getExpiresAt())) {
            throw new AppException(HttpStatus.GONE, "Share link has expired");
        }
        FileNode node = nodeRepo.findById(share.getNodeId()).orElse(null);
        return toResponse(share, node);
    }

    // ----------------------------------------------------------------
    //  Revoke
    // ----------------------------------------------------------------

    @Transactional
    public void revokeShare(String userId, String shareId) {
        Share share = shareRepo.findByIdAndOwnerId(shareId, userId)
                .orElseThrow(() -> new AppException(HttpStatus.NOT_FOUND, "Share not found"));
        shareRepo.delete(share);
    }

    // ----------------------------------------------------------------

    private ShareResponse toResponse(Share share, FileNode node) {
        String granteeEmail = null;
        if (share.getGranteeId() != null) {
            granteeEmail = userRepo.findById(share.getGranteeId())
                    .map(User::getEmail).orElse(null);
        }
        String shareUrl = share.getToken() != null
                ? "http://localhost:8080/api/shares/link/" + share.getToken()
                : null;
        return ShareResponse.builder()
                .id(share.getId())
                .nodeId(share.getNodeId())
                .nodeName(node != null ? node.getName() : null)
                .shareType(share.getShareType())
                .granteeId(share.getGranteeId())
                .granteeEmail(granteeEmail)
                .permission(share.getPermission())
                .token(share.getToken())
                .shareUrl(shareUrl)
                .expiresAt(share.getExpiresAt())
                .createdAt(share.getCreatedAt())
                .build();
    }
}

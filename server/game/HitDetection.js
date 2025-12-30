// Hit Detection - Server-side raycast and lag compensation
export class HitDetection {
    constructor() {
        // Hitboxes exactly matching SniperModel dimensions
        this.hitboxes = {
            HEAD: { size: { x: 0.3, y: 0.3, z: 0.3 }, offset: { x: 0, y: 1.7, z: 0 } },
            UPPER_BODY: { size: { x: 0.5, y: 0.5, z: 0.3 }, offset: { x: 0, y: 1.35, z: 0 } },
            LOWER_BODY: { size: { x: 0.45, y: 0.3, z: 0.28 }, offset: { x: 0, y: 0.95, z: 0 } },
            LEFT_ARM: { size: { x: 0.12, y: 0.6, z: 0.12 }, offset: { x: -0.35, y: 1.35, z: 0.2 } },
            RIGHT_ARM: { size: { x: 0.12, y: 0.6, z: 0.12 }, offset: { x: 0.35, y: 1.35, z: 0.1 } },
            LEFT_LEG: { size: { x: 0.18, y: 0.9, z: 0.22 }, offset: { x: -0.15, y: 0.45, z: 0 } },
            RIGHT_LEG: { size: { x: 0.18, y: 0.9, z: 0.22 }, offset: { x: 0.15, y: 0.45, z: 0 } }
        };
    }

    performRaycast(origin, direction, players, shooterId, timestamp, stateHistory) {
        const compensatedState = this.getCompensatedState(timestamp, stateHistory);
        let closestHit = null;

        for (const [playerId, player] of players) {
            if (playerId === shooterId || player.isDead) continue;

            const playerPos = compensatedState?.players[playerId]?.position || player.position;
            const playerYaw = compensatedState?.players[playerId]?.rotation?.yaw || player.rotation.yaw || 0;

            // Check each hitbox
            for (const [boxName, box] of Object.entries(this.hitboxes)) {
                // For simplicity, we use AABB after applying player position.
                // For "perfect" precision, we should ideally account for player YAW.
                // However, Box-Ray with AABB is already much more precise than spheres.
                const hit = this.checkRayBoxIntersection(origin, direction, playerPos, playerYaw, box);

                if (hit && (!closestHit || hit.distance < closestHit.distance)) {
                    closestHit = {
                        hit: true,
                        victimId: playerId,
                        hitbox: boxName,
                        impactPoint: hit.point,
                        distance: hit.distance
                    };
                }
            }
        }

        return closestHit || { hit: false };
    }

    checkRayBoxIntersection(rayOrigin, rayDir, playerPos, playerYaw, box) {
        // Transform the ray into the box's local space (effectively rotating the box)
        // 1. Translate ray relative to player position
        const relOrigin = {
            x: rayOrigin.x - playerPos.x,
            y: rayOrigin.y - playerPos.y,
            z: rayOrigin.z - playerPos.z
        };

        // 2. Rotate ray around Y axis by -playerYaw
        // We need to rotate the Ray opposite to the Player's rotation
        const cos = Math.cos(-playerYaw);
        const sin = Math.sin(-playerYaw);

        const localOrigin = {
            x: relOrigin.x * cos - relOrigin.z * sin,
            y: relOrigin.y,
            z: relOrigin.x * sin + relOrigin.z * cos
        };

        const localDir = {
            x: rayDir.x * cos - rayDir.z * sin,
            y: rayDir.y,
            z: rayDir.x * sin + rayDir.z * cos
        };

        // 3. Define Box AABB in local space (relative to 0,0,0 player center)
        // Box offset is already local to player
        const boxCenter = box.offset;
        const half = {
            x: box.size.x / 2,
            y: box.size.y / 2,
            z: box.size.z / 2
        };

        const min = { x: boxCenter.x - half.x, y: boxCenter.y - half.y, z: boxCenter.z - half.z };
        const max = { x: boxCenter.x + half.x, y: boxCenter.y + half.y, z: boxCenter.z + half.z };

        // Ray-AABB Slab Method (Standard)
        // X Axis
        let tmin = -Infinity, tmax = Infinity;
        if (Math.abs(localDir.x) > 1e-9) {
            let t1 = (min.x - localOrigin.x) / localDir.x;
            let t2 = (max.x - localOrigin.x) / localDir.x;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (localOrigin.x < min.x || localOrigin.x > max.x) return null;

        // Y Axis
        if (Math.abs(localDir.y) > 1e-9) {
            let t1 = (min.y - localOrigin.y) / localDir.y;
            let t2 = (max.y - localOrigin.y) / localDir.y;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (localOrigin.y < min.y || localOrigin.y > max.y) return null;

        // Z Axis
        if (Math.abs(localDir.z) > 1e-9) {
            let t1 = (min.z - localOrigin.z) / localDir.z;
            let t2 = (max.z - localOrigin.z) / localDir.z;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (localOrigin.z < min.z || localOrigin.z > max.z) return null;

        if (tmax >= tmin && tmax > 0) {
            const t = tmin > 0 ? tmin : tmax;
            return {
                distance: t,
                point: {
                    x: rayOrigin.x + rayDir.x * t,
                    y: rayOrigin.y + rayDir.y * t,
                    z: rayOrigin.z + rayDir.z * t
                }
            };
        }

        return null;
    }

    getCompensatedState(clientTimestamp, stateHistory) {
        if (!stateHistory || stateHistory.length === 0) return null;

        let closest = stateHistory[0];
        let minDiff = Math.abs(closest.timestamp - clientTimestamp);

        for (const snapshot of stateHistory) {
            const diff = Math.abs(snapshot.timestamp - clientTimestamp);
            if (diff < minDiff) {
                minDiff = diff;
                closest = snapshot;
            }
        }

        if (minDiff > 250) return null;
        return closest;
    }
}

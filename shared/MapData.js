// Map Data - Shared geometry for client and server
// Units are in meters (Three.js units)

export const MAP_GEOMETRY = {
    SIZE: 60,
    WALL_HEIGHT: 8,
    TOWERS: [
        { x: -28, z: -28, size: 4, height: 25 },
        { x: 28, z: -28, size: 4, height: 25 },
        { x: -28, z: 28, size: 4, height: 25 },
        { x: 28, z: 28, size: 4, height: 25 }
    ],
    // Fixed cover positions to ensure hidden spawns are possible and collision is synced
    COVER: [
        { x: -15, z: 10, w: 2, h: 4, d: 2 },
        { x: -15, z: -10, w: 2, h: 4, d: 2 },
        { x: 15, z: 10, w: 2, h: 4, d: 2 },
        { x: 15, z: -10, w: 2, h: 4, d: 2 },
        { x: 0, z: 20, w: 6, h: 3, d: 2 },
        { x: 0, z: -20, w: 6, h: 3, d: 2 },
        { x: -20, z: 0, w: 2, h: 3, d: 6 },
        { x: 20, z: 0, w: 2, h: 3, d: 6 },
        // New cover objects
        { x: -8, z: 8, w: 3, h: 2, d: 3 },
        { x: 8, z: -8, w: 3, h: 2, d: 3 },
        { x: -8, z: -8, w: 3, h: 2, d: 3 },
        { x: 8, z: 8, w: 3, h: 2, d: 3 },
        { x: 0, z: 0, w: 2, h: 5, d: 2 }, // Center pillar
        { x: -22, z: 15, w: 4, h: 2, d: 1 },
        { x: 22, z: -15, w: 4, h: 2, d: 1 },
        { x: -5, z: 25, w: 1, h: 4, d: 4 },
        { x: 5, z: -25, w: 1, h: 4, d: 4 }
    ],
    // "Hidden" Spawn Points distributed across the map
    SPAWN_POINTS: [
        { x: -24, y: 0, z: -24, yaw: 0 },         // NW
        { x: 24, y: 0, z: -24, yaw: Math.PI },    // NE
        { x: -24, y: 0, z: 24, yaw: 0 },          // SW
        { x: 24, y: 0, z: 24, yaw: Math.PI },     // SE
        { x: -18, y: 0, z: 0, yaw: -Math.PI / 2 }, // W
        { x: 18, y: 0, z: 0, yaw: Math.PI / 2 },  // E
        { x: 0, y: 0, z: -24, yaw: Math.PI },     // N
        { x: 0, y: 0, z: 24, yaw: 0 }             // S
    ]
};

/**
 * Checks if a point with a radius is colliding with any map geometry (AABB)
 * @param {Object} pos - {x, y, z}
 * @param {number} radius 
 * @returns {boolean}
 */
export function checkMapCollision(pos, radius = 0.4) {
    const halfSize = MAP_GEOMETRY.SIZE / 2;

    // Perimeter Walls
    if (Math.abs(pos.x) > halfSize - radius - 0.5) return true;
    if (Math.abs(pos.z) > halfSize - radius - 0.5) return true;

    // Towers
    for (const t of MAP_GEOMETRY.TOWERS) {
        const dx = Math.abs(pos.x - t.x);
        const dz = Math.abs(pos.z - t.z);
        const towerHalf = t.size / 2;
        if (dx < towerHalf + radius && dz < towerHalf + radius) return true;
    }

    // Cover
    for (const c of MAP_GEOMETRY.COVER) {
        const dx = Math.abs(pos.x - c.x);
        const dz = Math.abs(pos.z - c.z);
        if (dx < c.w / 2 + radius && dz < c.d / 2 + radius) return true;
    }

    return false;
}

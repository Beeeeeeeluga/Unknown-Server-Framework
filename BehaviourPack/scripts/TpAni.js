// ============================================================
//  传送动画模块（兼容 1.20.10 ~ 1.21+）
//  支持可打断的倒计时 + 三段式摄像机动画
//  更新打断系统
// ============================================================

import { world, system } from "@minecraft/server";
import { config } from "./Main.js";

const CAM = { rise: 2, move: 3, fall: 1 };
const MSG = {
    cancel: "§e×§c传送已被打断§e×",
    loading: "§a→§f传送加载中，请不要移动... ",
    executing: "§a→§f传送系统执行中§a←",
    moving: "§a→§f开始移动至坐标点§a←",
    falling: "§a→§f开始降落§a←",
    done: "§a√§f动画传送完成§a√",
};
const COUNTDOWN_SEC = 2;
const MOVE_THRESHOLD = 0.01;

function isAnimationEnabled() {
    return config?.tp?.animation ?? true;   // 默认开启
}

//  维度工具
function getDimensionById(id) {
    switch (id) {
        case "minecraft:nether":   return world.getDimension("minecraft:nether");
        case "minecraft:the_end":  return world.getDimension("minecraft:the_end");
        default:                   return world.getDimension("minecraft:overworld");
    }
}

// 简单传送（无动画）
function simpleTeleport(player, location, dimension, onDone) {
    try {
        player.teleport(location, { dimension });
        if (typeof onDone === "function") onDone(true);
    } catch (e) {
        console.warn("简单传送失败:", e);
        if (typeof onDone === "function") onDone(false);
    }
}
export function tpWithAnimation(player, location, dimension, onDone) {
    const callback = typeof onDone === "function" ? onDone : () => {};
    if (!player || !player.isValid) {
        callback(false);
        return;
    }
    if (isAnimationEnabled()) {
        performTeleportAnimation(player, location, dimension)
            .then(() => callback(true))
            .catch(() => callback(false));
    } else {
        simpleTeleport(player, location, dimension, callback);
    }
}

// ---------- 倒计时 + 打断检测 ----------
export function performTeleportAnimation(player, targetLocation, targetDimension) {
    return new Promise((resolve, reject) => {
        if (!player.isValid) {
            reject(new Error("Player invalid"));
            return;
        }

        let tick = 0;
        const totalTicks = COUNTDOWN_SEC * 20;
        let prevLoc = { x: player.location.x, z: player.location.z };

        const intervalId = system.runInterval(() => {
            if (!player.isValid) {
                system.clearRun(intervalId);
                reject(new Error("Player left"));
                return;
            }

            const dx = Math.abs(player.location.x - prevLoc.x);
            const dz = Math.abs(player.location.z - prevLoc.z);
            if (dx > MOVE_THRESHOLD || dz > MOVE_THRESHOLD) {
                system.clearRun(intervalId);
                player.onScreenDisplay.setActionBar(MSG.cancel);
                system.runTimeout(() => {
                    if (player.isValid) player.onScreenDisplay.setActionBar("");
                }, 40);
                player.sendMessage("传送被打断");
                reject(new Error("interrupted"));
                return;
            }
            prevLoc = { x: player.location.x, z: player.location.z };

            const pct = Math.floor(++tick / totalTicks * 100);
            player.onScreenDisplay.setActionBar(`${MSG.loading} ${pct}%§a←`);

            if (tick >= totalTicks) {
                system.clearRun(intervalId);
                executeTeleportSequence(player, targetLocation, targetDimension, resolve);
            }
        });
    });
}

// ---------- 三段式摄像机动画 ----------
function executeTeleportSequence(player, loc, dim, done) {
    if (!player.isValid) { done(); return; }

    const { rise, move, fall } = CAM;

    const safeCommand = (cmd) => {
        try {
            player.runCommand(cmd);
        } catch (e) {
            console.warn("命令执行失败:", cmd, e);
        }
    };

    // 上升
    safeCommand(`camera @s set minecraft:free ease ${rise} out_expo pos ~ ~50 ~ facing ~ ~-1 ~`);
    player.onScreenDisplay.setActionBar(MSG.executing);

    system.runTimeout(() => {
        if (!player.isValid) { done(); return; }

        // 传送到高空
        try {
            player.teleport({ x: loc.x, y: 10000, z: loc.z }, { dimension: dim });
        } catch (e) {
            console.warn("高空传送失败，尝试直接传送目标点", e);
            try {
                player.teleport(loc, { dimension: dim });
            } catch (ignored) {}
            player.onScreenDisplay.setActionBar("§c传送失败，已回退");
            done();
            return;
        }
        player.onScreenDisplay.setActionBar(MSG.moving);
        safeCommand(`camera @s set minecraft:free ease ${move} in_out_expo pos ${loc.x} ${loc.y + 50} ${loc.z}`);

        system.runTimeout(() => {
            if (!player.isValid) { done(); return; }

            // 下降
            try {
                player.teleport(loc, { dimension: dim });
            } catch (e) {
                console.warn("目标点传送失败", e);
                player.onScreenDisplay.setActionBar("§c传送失败");
                done();
                return;
            }
            safeCommand(`camera @s set minecraft:free ease ${fall} in_cubic pos ~ ~1.6 ~ facing ^ ^1.5 ^10`);
            player.onScreenDisplay.setActionBar(MSG.falling);

            system.runTimeout(() => {
                if (player.isValid) {
                    safeCommand("camera @s clear");
                    player.onScreenDisplay.setActionBar(MSG.done);
                }
                done();
            }, fall * 20);
        }, move * 20);
    }, rise * 20);
}

// ---------- 向后兼容的旧接口（保留） ----------
export function enhancedTeleport(player, x, y, z, dimensionId) {
    tpWithAnimation(player, { x, y, z }, getDimensionById(dimensionId));
}

export function enhancedEntityTeleport(source, target) {
    tpWithAnimation(source, target.location, target.dimension);
}

//小洋葱出品
//打断版
// What the warden carries and how the UI shows it. The son has a sword and a bow, the daughter a spear and a sling (the
// shots are in scene/projectiles.ts, the hero frames in pipeline/hero-animation.ts). Presentation only: the upgrades'
// ids, costs and effects are the same for both, and the sim never reads this.
import type { Sex } from "../scene/assets";
import { type Legacy, UPGRADES, type UpgradeId } from "./legacy";

export type StrikeIcon = "blade" | "spear";
export type ShootIcon = "shoot" | "sling";
type UpgradeIcon = UpgradeId | "spear" | "pouch";

export const ARMS: Record<Sex, { loadout: string; strikeIcon: StrikeIcon; shootIcon: ShootIcon }> = {
  male: { loadout: "sword and bow", strikeIcon: "blade", shootIcon: "shoot" },
  female: { loadout: "spear and sling", strikeIcon: "spear", shootIcon: "sling" },
};

// Where a daughter's shop differs from the son's, which is the default in UPGRADES: the melee and ranged upgrades
// follow her weapons.
const DAUGHTER_UPGRADES: Partial<Record<UpgradeId, { icon: UpgradeIcon; label: string; text?: string }>> = {
  blade: { icon: "spear", label: "Keener spear" },
  quiver: {
    icon: "pouch",
    label: "Fuller pouch",
    text: "Stones fly 15% faster; at level 2 you sling a spread of three.",
  },
};

export interface UpgradeView {
  icon: UpgradeIcon;
  label: string;
  text: string;
}

// An upgrade as the shop shows it to the warden it is for.
export function upgradeView(id: UpgradeId, sex: Sex): UpgradeView {
  const base = UPGRADES[id];
  const own = sex === "female" ? DAUGHTER_UPGRADES[id] : undefined;
  return { icon: own?.icon ?? id, label: own?.label ?? base.label, text: own?.text ?? base.text };
}

// The warden the shop is for: the one who held the night at dawn. On the heir screen it is the selected heir once one
// is picked, and the fallen warden until then, because choosing an heir replaces `legacy.heir` and nothing else does.
export function shopSex(legacy: Pick<Legacy, "heir">): Sex {
  return legacy.heir.sex;
}

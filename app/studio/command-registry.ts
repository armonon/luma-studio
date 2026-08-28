import {
  DESKTOP_MENU,
  menuCommands,
  type StudioCommand,
} from "../desktop/menu-model";

export type CommandDefinition = Readonly<{
  id: StudioCommand;
  label: string;
  shortcut: string;
}>;

export type RegisteredCommand = CommandDefinition & Readonly<{
  enabled: () => boolean;
  checked: () => boolean;
  execute: (handler?: (id: StudioCommand) => void) => boolean;
}>;

const commandMetadata = new Map<StudioCommand, CommandDefinition>();
for (const section of DESKTOP_MENU) {
  for (const item of section.items) {
    if (item.kind !== "command") continue;
    if (commandMetadata.has(item.id)) throw new Error(`Duplicate command registration: ${item.id}`);
    commandMetadata.set(item.id, {
      id: item.id,
      label: item.label,
      shortcut: item.accelerator ?? "",
    });
  }
}

export const COMMAND_DEFINITIONS: Readonly<Record<StudioCommand, CommandDefinition>> = Object.freeze(
  Object.fromEntries([...commandMetadata]) as Record<StudioCommand, CommandDefinition>,
);

export type CommandRegistryOptions = Readonly<{
  execute?: (id: StudioCommand) => void;
  enabled?: (id: StudioCommand) => boolean;
  checked?: (id: StudioCommand) => boolean;
}>;

/**
 * Runtime command facade used by native menus, shortcuts, title bars, and
 * palettes. The facade owns availability checks, so a disabled command cannot
 * be triggered through a less-visible surface such as a keyboard shortcut.
 */
export function createCommandRegistry(options: CommandRegistryOptions) {
  const enabled = options.enabled ?? (() => true);
  const checked = options.checked ?? (() => false);
  const get = (id: StudioCommand): RegisteredCommand => {
    const definition = COMMAND_DEFINITIONS[id];
    return {
      ...definition,
      enabled: () => enabled(id),
      checked: () => checked(id),
      execute: (handler = options.execute) => {
        if (!enabled(id)) return false;
        if (!handler) return false;
        handler(id);
        return true;
      },
    };
  };
  return Object.freeze({
    get,
    all: () => menuCommands().map(get),
    execute: (id: StudioCommand, handler?: (id: StudioCommand) => void) => get(id).execute(handler),
    enabled,
    checked,
  });
}

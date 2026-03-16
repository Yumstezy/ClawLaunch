import type { Permissions, ProfileKey } from "../types";

export type ProfileDefinition = {
  key: ProfileKey;
  name: string;
  description: string;
  permissions: Permissions;
  modelHint: string;
  summary: string;
  defaults: {
    responsePrefix: string;
    gatewayPort: number;
    browserEnabled: boolean;
    shellEnabled: boolean;
    automationEnabled: boolean;
    channelMode: "chatty" | "balanced" | "focused";
  };
};

export const profiles: Record<ProfileKey, ProfileDefinition> = {
  coding: {
    key: "coding",
    name: "Coding",
    description: "Best for coding, debugging, files, and technical workflows.",
    permissions: {
      files: true,
      terminal: true,
      browser: true,
      automation: false,
    },
    modelHint: "Stronger coding defaults",
    summary: "Terminal + files + browser enabled with focused coding behavior.",
    defaults: {
      responsePrefix: "[coding]",
      gatewayPort: 18789,
      browserEnabled: true,
      shellEnabled: true,
      automationEnabled: false,
      channelMode: "focused",
    },
  },

  daily: {
    key: "daily",
    name: "Daily",
    description: "General assistant setup for everyday help and personal use.",
    permissions: {
      files: false,
      terminal: false,
      browser: true,
      automation: false,
    },
    modelHint: "Safer everyday defaults",
    summary: "Simple assistant setup with lighter permissions and easy chat access.",
    defaults: {
      responsePrefix: "[daily]",
      gatewayPort: 18789,
      browserEnabled: true,
      shellEnabled: false,
      automationEnabled: false,
      channelMode: "chatty",
    },
  },

  gaming: {
    key: "gaming",
    name: "Gaming",
    description: "Discord-first setup for gaming communities and quick responses.",
    permissions: {
      files: false,
      terminal: false,
      browser: true,
      automation: false,
    },
    modelHint: "Fast chat-first behavior",
    summary: "Discord-focused profile with lighter tool usage and fast replies.",
    defaults: {
      responsePrefix: "[gaming]",
      gatewayPort: 18789,
      browserEnabled: true,
      shellEnabled: false,
      automationEnabled: false,
      channelMode: "chatty",
    },
  },

  tasks: {
    key: "tasks",
    name: "Tasks",
    description: "For automations, workflows, and action-heavy execution.",
    permissions: {
      files: true,
      terminal: true,
      browser: false,
      automation: true,
    },
    modelHint: "Automation-focused defaults",
    summary: "Built for actions, workflows, and stronger execution permissions.",
    defaults: {
      responsePrefix: "[tasks]",
      gatewayPort: 18789,
      browserEnabled: false,
      shellEnabled: true,
      automationEnabled: true,
      channelMode: "focused",
    },
  },

  mixed: {
    key: "mixed",
    name: "Mixed",
    description: "Balanced setup for users who want a bit of everything.",
    permissions: {
      files: true,
      terminal: true,
      browser: true,
      automation: true,
    },
    modelHint: "Balanced all-around defaults",
    summary: "Balanced profile with the broadest capabilities enabled.",
    defaults: {
      responsePrefix: "[mixed]",
      gatewayPort: 18789,
      browserEnabled: true,
      shellEnabled: true,
      automationEnabled: true,
      channelMode: "balanced",
    },
  },
};
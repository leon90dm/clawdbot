import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { larkPlugin } from "./src/channel.js";

const plugin = {
  id: "lark",
  name: "Lark/Feishu",
  description: "Lark/Feishu channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: larkPlugin });
  },
};

export default plugin;

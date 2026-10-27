import { EMBEDDED_CONFIG, PLUGIN_ROOT, embeddedConfigExists } from '../core/config.mjs';

export async function showConfig({ args, config, configSource }) {
  if (args.path) {
    console.log(configSource || EMBEDDED_CONFIG);
    return;
  }

  console.log('插件根目录:', PLUGIN_ROOT);
  console.log('配置文件  :', EMBEDDED_CONFIG, embeddedConfigExists() ? '' : '(缺失，使用内置默认)');
  console.log('');
  console.log('生效配置:');
  console.log(JSON.stringify(config, null, 2));
}

import { createToken, tokens } from "@ovule/ioc";
import type { I18nService, LanguageModeHook } from "./i18n";

export default tokens({
  i18n: createToken<I18nService>("I18nService"),
  languageModeHook: createToken<LanguageModeHook>("LanguageModeHook"),
});

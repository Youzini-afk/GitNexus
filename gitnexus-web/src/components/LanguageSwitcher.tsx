import { Globe } from '@/lib/lucide-icons';
import { useLocale } from '../i18n';

export const LanguageSwitcher = () => {
  const { locale, setLocale, t } = useLocale();
  const label = locale === 'zh' ? '中' : 'EN';

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      title={t('header.switchLanguage')}
      className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
    >
      <Globe className="h-4 w-4" />
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
};

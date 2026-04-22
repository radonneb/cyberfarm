import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AppLanguage } from '../models/taskData'

type Dictionary = Record<string, string>

const dictionaries: Record<AppLanguage, Dictionary> = {
  en: {
    import_title: 'Import',
    import_subtitle: 'Import tractor XML files and view fields and guidance lines on the map.',
    history_title: 'File History',
    no_files: 'No imported files yet',
    after_first_import: 'Your imported files will appear here.',
    open_test_xml: 'Open Test XML',
    import_xml: 'Import XML',
    created_by: 'Created by Muraddin',
    language: 'Language',
    about: 'About',
    error_title: 'Error',
    field: 'Field',
    fields: 'Fields',
    client: 'Client',
    farm: 'Farm',
    area: 'Area',
    lines: 'Lines',
    operation: 'Operation',
    material: 'Material',
    width: 'Width',
    passes: 'Passes',
    coverage: 'Coverage',
    coordinates: 'Coordinates',
    no_guidance: 'No guidance lines',
    file: 'File',
    ha: 'ha',
    m: 'm',
    more_lines: 'More lines',
    no_coords: 'No coordinates',
    options: 'Options',
    import: 'Import',
    export: 'Export',
    create_field: 'Create Field',
    create_guidance: 'Create Guidance',
    edit: 'Edit',
    save: 'Save',
    save_as: 'Save As',
    search_field: 'Search field...',
    empty_map: 'Empty map',
    selected_field: 'Selected field',
    not_selected: 'Not selected',
  },
  ru: {
    import_title: 'Импорт',
    import_subtitle: 'Загружай XML-файлы трактора, смотри поля и направляющие линии на карте.',
    history_title: 'История файлов',
    no_files: 'Пока нет загруженных файлов',
    after_first_import: 'После первого импорта здесь появится история.',
    open_test_xml: 'Открыть тестовый XML',
    import_xml: 'Импорт XML',
    created_by: 'Created by Muraddin',
    language: 'Язык',
    about: 'О приложении',
    error_title: 'Ошибка',
    field: 'Поле',
    fields: 'Поля',
    client: 'Клиент',
    farm: 'Ферма',
    area: 'Площадь',
    lines: 'Линий',
    operation: 'Операция',
    material: 'Материал',
    width: 'Ширина',
    passes: 'Проходы',
    coverage: 'Охват',
    coordinates: 'Координаты',
    no_guidance: 'Нет направляющих',
    file: 'Файл',
    ha: 'га',
    m: 'м',
    more_lines: 'Еще линий',
    no_coords: 'Нет координат',
    options: 'Опции',
    import: 'Импорт',
    export: 'Экспорт',
    create_field: 'Создать поле',
    create_guidance: 'Создать линии',
    edit: 'Редактировать',
    save: 'Сохранить',
    save_as: 'Сохранить как',
    search_field: 'Поиск поля...',
    empty_map: 'Пустая карта',
    selected_field: 'Выбранное поле',
    not_selected: 'Не выбрано',
  },
  az: {
    import_title: 'İdxal',
    import_subtitle: 'Traktor XML fayllarını yüklə, sahələri və istiqamət xətlərini xəritədə göstər.',
    history_title: 'Fayl tarixçəsi',
    no_files: 'Hələ yüklənmiş fayl yoxdur',
    after_first_import: 'İlk idxaldan sonra fayllar burada görünəcək.',
    open_test_xml: 'Test XML aç',
    import_xml: 'XML idxal et',
    created_by: 'Created by Muraddin',
    language: 'Dil',
    about: 'Haqqında',
    error_title: 'Xəta',
    field: 'Sahə',
    fields: 'Sahələr',
    client: 'Müştəri',
    farm: 'Ferma',
    area: 'Sahə ölçüsü',
    lines: 'Xətlər',
    operation: 'Əməliyyat',
    material: 'Material',
    width: 'En',
    passes: 'Keçidlər',
    coverage: 'Əhatə',
    coordinates: 'Koordinatlar',
    no_guidance: 'İstiqamət xətləri yoxdur',
    file: 'Fayl',
    ha: 'ha',
    m: 'm',
    more_lines: 'Daha çox xətt',
    no_coords: 'Koordinatlar yoxdur',
    options: 'Seçimlər',
    import: 'İdxal',
    export: 'İxrac',
    create_field: 'Sahə yarat',
    create_guidance: 'Xətt yarat',
    edit: 'Düzəliş et',
    save: 'Yadda saxla',
    save_as: 'Fərqli yadda saxla',
    search_field: 'Sahə axtar...',
    empty_map: 'Boş xəritə',
    selected_field: 'Seçilmiş sahə',
    not_selected: 'Seçilməyib',
  },
}

type I18nContextValue = {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  t: (key: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() => {
    const saved = localStorage.getItem('app_language')
    if (saved === 'ru' || saved === 'en' || saved === 'az') return saved
    return 'en'
  })

  useEffect(() => {
    localStorage.setItem('app_language', language)
  }, [language])

  const value = useMemo<I18nContextValue>(() => {
    return {
      language,
      setLanguage,
      t: (key: string) => dictionaries[language][key] ?? key,
    }
  }, [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
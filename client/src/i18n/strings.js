// English and Urdu strings. The field screens (Today, daily report, purchase
// form, camera, outbox), the house's home screen, navigation and status chips
// are translated. Other screens fall back to English for now.
//
// Keys are '<area>.<name>'; {placeholders} are filled by t(key, vars) in
// I18nProvider. Both languages carry the same keys in the same order, so a
// missing Urdu key is easy to spot. URDU_TERMS covers domain words (stages,
// steps, expense types, weather) that arrive from the server in English;
// STEP_DETAILS is the English-only one-liner under each step.
//
// FILE: client/src/i18n/strings.js. Pure data, no logic: imported only by
// I18nProvider.jsx (STRINGS, URDU_TERMS) and by the step rows that show
// STEP_DETAILS. Depends on nothing.
// Syntax used throughout: `export const NAME = { ... }` exports an object
// literal; each line `'key': 'value',` is one property. Keys containing dots
// must be quoted; a trailing comma after the last property is allowed.
// Strings in "double quotes" are used when the text itself has an apostrophe.

// The dictionaries, one nested object per language code ('en', 'ur').
// Lookup in I18nProvider: STRINGS[locale][key].
export const STRINGS = {
  // English: the reference language; every key exists here.
  en: {
    // Navigation labels (layout/nav.js, tab bar, sidebar, More page).
    'nav.projects': 'Houses',
    'nav.account': 'Account',
    'nav.home': 'Home',
    'nav.today': 'Today',
    'nav.progress': 'Progress',
    'nav.money': 'Money',
    'nav.budget': 'Budget',
    'nav.materials': 'Materials',
    'nav.reports': 'Reports',
    'nav.purchases': 'Purchases',
    'nav.payments': 'Payments',
    'nav.approvals': 'Approvals',
    'nav.questions': 'Questions',
    'nav.changes': 'Changes',
    'nav.findings': 'Findings',
    'nav.documents': 'Documents',
    'nav.drawings': 'Drawings',
    'nav.history': 'History',
    'nav.inspections': 'Inspections',
    'nav.settings': 'Settings',
    'nav.more': 'More',

    // Shared words and the app shell (AppShell, Notifications, OfflineBanner).
    'common.language': 'Language',
    'common.back': 'back',
    'common.optional': 'optional',
    'common.seeAll': 'see all',
    'common.signOut': 'Sign out',
    'common.notifications': 'Notifications',
    'common.retry': 'retry',
    'common.discard': 'discard',

    // App shell (AppShell.jsx): skip link, sidebar, tab bar and the house switcher. {n} is a percentage.
    'shell.skip': 'Skip to content',
    'shell.sidebar': 'Sidebar',
    'shell.tabs': 'Tabs',
    'shell.yourHouses': 'Your houses',
    'shell.allHouses': 'All houses',
    'shell.addHouse': 'Add a house',
    'shell.current': 'Current',
    'shell.built': '{n}% built',

    // Notifications bell and panel. {n} is the unread count.
    'notifications.unread': '{n} unread notifications',
    'notifications.markAll': 'mark all read',
    'notifications.empty': 'You’re all caught up.',

    // Offline banner: plain, many saved items ({n}), or exactly one saved item.
    'offline.plain': 'No signal. Keep working: what you save stays on this phone and sends by itself.',
    'offline.withItems': 'No signal. {n} items are saved on this phone and will send on their own when you are back online.',
    'offline.withItem': 'No signal. 1 item is saved on this phone and will send on its own when you are back online.',

    // Money units (StatRow units on Home) and the project Home page.
    'money.lakh': 'lakh',
    'money.crore': 'crore',
    'money.rupees': 'rupees',

    // Project Home page: status sentence ({stage}, {done}, {next}, {verb}), stat labels and quick actions.
    'home.complete': 'The house is complete.',
    'home.status': '{stage}: {done} done. {next} {verb} next.',
    'home.started': '{stage} has started. {next} first.',
    'home.finished': '{stage} is finished.',
    'home.built': '{n}% built',
    'home.next': 'next: {step}',
    'home.spent': 'spent',
    'home.waiting': 'waiting',
    'home.over': 'over budget',
    'home.left': 'left in budget',
    'home.percentBuilt': '% built',
    'home.reportsWeek': 'reports this week',
    'home.waitingHead': 'Waiting',
    'home.review': 'review approvals',
    'home.addPurchase': 'add purchase',

    // Field screens: Today page, outbox rows and toasts, the live camera, step rows (WorkItems).
    'today.title': 'Today',
    'today.reportTile': 'Daily report',
    'today.reportDue': 'due by 6 pm',
    'today.reportSent': 'sent today',
    'today.reportSaved': 'saved, sending',
    'today.purchaseTile': 'Add purchase',
    'today.purchaseHint': 'receipt needed',
    'today.photo': 'Take a photo',
    'today.photoHint': 'Progress, delivery or receipt',
    'today.uploadInstead': 'upload instead',
    'today.outbox': 'Outbox',
    'today.outboxCount': '{n} saved',
    'today.work': "Today's work",
    'today.workHint': 'Switch a step on when it is finished.',
    'today.needs': 'Needs you',
    'today.allClear': 'Nothing is waiting for you.',
    'today.photoSaved': 'Photo saved',
    'today.photosToday': '{n} photos today',
    'today.photoToday': '1 photo today',

    // Outbox (items saved offline): row titles by record kind, send state, toasts and sign-out warnings.
    'outbox.REPORT': 'Daily report, {n} photos',
    'outbox.REPORT1': 'Daily report, 1 photo',
    'outbox.PURCHASE': 'Purchase, {name}',
    'outbox.PHOTO': 'Photo, {name}',
    'outbox.sending': 'Sending, {sent} of {total} photos',
    'outbox.sendingRecord': 'Sending',
    'outbox.saved': 'Saved {time}',
    'outbox.waiting': 'Waiting for a better signal',
    'outbox.failed': "Couldn't send: {error}",
    'outbox.savedToast': 'Saved on this phone. It will send by itself.',
    'outbox.saveFailed': 'Couldn’t save on this phone. Free some space or leave private browsing, then try again.',
    'outbox.discardConfirm': 'Remove this from the phone? It has not been sent.',
    'outbox.signOutOne': '1 item hasn’t been sent yet. It stays saved on this phone and will send the next time you sign in. Sign out anyway?',
    'outbox.signOutMany': '{n} items haven’t been sent yet. They stay saved on this phone and will send the next time you sign in. Sign out anyway?',

    // Live camera (CameraCapture): mode labels keyed by evidence kind, GPS status, buttons and errors.
    'camera.title': 'Camera',
    'camera.RECEIPT': 'receipt',
    'camera.DELIVERY_PHOTO': 'delivery',
    'camera.PHOTO': 'progress',
    'camera.live': 'live camera',
    'camera.fromSite': '{d} from site',
    'camera.accuracy': 'GPS within {a} m',
    'camera.locating': 'Finding your location…',
    'camera.noPin': 'No site pin yet',
    'camera.gpsOff': 'Location is off',
    'camera.capture': 'Take photo',
    'camera.retake': 'retake',
    'camera.use': 'use this photo',
    'camera.switch': 'Switch camera',
    'camera.blocked': 'Camera permission was blocked. Allow the camera in your browser, or upload a file instead.',
    'camera.none': 'No camera was found on this device. Upload a file instead.',

    // Step rows (WorkItems): inspection state and done / not done.
    'step.inspected': 'Inspected and passed',
    'step.needsInspection': 'Needs an engineer’s inspection',
    'step.needsFixes': 'Inspection: needs fixes',
    'step.through': '{n}% through',
    'step.done': 'Done',
    'step.notDone': 'Not done yet',

    // Forms: the daily report wizard, the purchase form, the Progress page.
    // Daily report wizard (NewReportPage): three steps (work, photos, notes) and their fields.
    'report.title': 'Daily report',
    'report.step.work': 'work done today',
    'report.step.photos': 'photos',
    'report.step.notes': 'notes',
    'report.stepOf': 'Step {n} of 3, {name}',
    'report.workIntro': 'Switch on the steps finished so far, then say what was done today.',
    'report.summary': 'What work was done today?',
    'report.summaryHint': 'Mention quantities, e.g. “Laid about 3,000 bricks on the front wall.”',
    'report.stageDone': '{stage} is completely finished',
    'report.photosIntro': 'Use the live camera. Photos picked from the gallery are marked as lower trust for the owner.',
    'report.addPhoto': 'add photo',
    'report.caption': 'Caption for the owner',
    'report.workers': 'Workers on site',
    'report.weather': 'Weather',
    'report.issues': 'Problems today',
    'report.issuesHint': 'Shortages, rain, missing drawings: anything the owner should know.',
    'report.materials': 'Materials used today',
    'report.addMaterial': 'add material',
    'report.nextPhotos': 'next: photos',
    'report.nextNotes': 'next: notes',
    'report.submit': 'send report',
    'report.submitted': 'Report sent',

    // Purchase form (PurchaseFormPage): supplier, line items, evidence slots and submit buttons.
    'purchase.new': 'New purchase',
    'purchase.edit': 'Edit purchase',
    'purchase.supplier': 'Supplier or person paid',
    'purchase.invoice': 'Invoice or slip number',
    'purchase.date': 'Purchase date',
    'purchase.items': 'Items',
    'purchase.item': 'Item',
    'purchase.chooseItem': 'Choose from the materials list…',
    'purchase.otherItem': 'Something not on the list',
    'purchase.qty': 'Quantity',
    'purchase.unit': 'Unit',
    'purchase.rate': 'Price per unit',
    'purchase.total': 'Total',
    'purchase.addItem': 'add another item',
    'purchase.evidence': 'Evidence',
    'purchase.evidenceCount': '{n} of {m}',
    'purchase.receipt': 'Receipt or slip',
    'purchase.receiptHint': 'A photo of a handwritten slip is fine.',
    'purchase.delivery': 'Delivery photo',
    'purchase.deliveryHint': 'Take it at the site with the live camera.',
    'purchase.missingDelivery': 'Add a delivery photo to submit. Material purchases need both.',
    'purchase.missingProof': 'Add a receipt or slip to submit.',
    'purchase.fromAdvance': 'Paid from the advance',
    'purchase.fromAdvanceHint': 'Money the owner gave you in advance.',
    'purchase.notes': 'Notes',
    'purchase.submit': 'submit for approval',
    'purchase.record': 'save purchase',
    'purchase.draft': 'save draft',

    // Progress page: stage heading and stage controls.
    'progress.title': 'Progress',
    'progress.stageOf': 'Stage {n} of {m}, {stage}',
    'progress.markComplete': 'mark {stage} complete',
    'progress.reopen': 'reopen the previous stage',
    'progress.needsSignal': 'Needs a connection. You can also add it in your daily report.',

    // Status chips: 'chip.<kind>.<STATUS>', looked up by StatusChip; kinds without a key show lib/status.js English.
    'chip.expense.DRAFT': 'draft',
    'chip.expense.SUBMITTED': 'evidence',
    'chip.expense.QUERIED': 'question',
    'chip.expense.APPROVED': 'approved',
    'chip.expense.REJECTED': 'rejected',
    'chip.expense.VERIFIED': 'verified',
    'chip.expense.FLAGGED': 'price check',
    // Outbox item states.
    'chip.outbox.WAITING': 'waiting',
    'chip.outbox.SENDING': 'sending',
    'chip.outbox.FAILED': 'not sent',
  },
  // Urdu: same keys, same groups as above.
  // Urdu text is right-to-left; {placeholders} stay in Latin letters so t() can fill them.
  ur: {
    // Navigation labels.
    'nav.projects': 'گھر',
    'nav.account': 'اکاؤنٹ',
    'nav.home': 'ہوم',
    'nav.today': 'آج',
    'nav.progress': 'پیش رفت',
    'nav.money': 'رقم',
    'nav.budget': 'بجٹ',
    'nav.materials': 'سامان',
    'nav.reports': 'رپورٹیں',
    'nav.purchases': 'خریداری',
    'nav.payments': 'ادائیگیاں',
    'nav.approvals': 'منظوری',
    'nav.questions': 'سوالات',
    'nav.changes': 'تبدیلیاں',
    'nav.findings': 'نشاندہی',
    'nav.documents': 'دستاویزات',
    'nav.drawings': 'نقشے',
    'nav.history': 'تاریخچہ',
    'nav.inspections': 'معائنے',
    'nav.settings': 'ترتیبات',
    'nav.more': 'مزید',

    // Shared words.
    'common.language': 'زبان',
    'common.back': 'واپس',
    'common.optional': 'اختیاری',
    'common.seeAll': 'سب دیکھیں',
    'common.signOut': 'سائن آؤٹ',
    'common.notifications': 'اطلاعات',
    'common.retry': 'دوبارہ کوشش',
    'common.discard': 'ختم کریں',

    // App shell.
    'shell.skip': 'مواد پر جائیں',
    'shell.sidebar': 'سائیڈ بار',
    'shell.tabs': 'ٹیبز',
    'shell.yourHouses': 'آپ کے گھر',
    'shell.allHouses': 'سب گھر',
    'shell.addHouse': 'گھر شامل کریں',
    'shell.current': 'موجودہ',
    'shell.built': '{n}% تعمیر',

    // Notifications.
    'notifications.unread': '{n} نئی اطلاعات',
    'notifications.markAll': 'سب پڑھی ہوئی',
    'notifications.empty': 'کوئی نئی اطلاع نہیں۔',

    // Offline banner.
    'offline.plain': 'سگنل نہیں ہے۔ کام جاری رکھیں: جو محفوظ کریں گے وہ فون پر رہے گا اور خود بخود بھیج دیا جائے گا۔',
    'offline.withItems': 'سگنل نہیں ہے۔ {n} چیزیں اس فون پر محفوظ ہیں اور انٹرنیٹ آتے ہی خود بخود بھیج دی جائیں گی۔',
    'offline.withItem': 'سگنل نہیں ہے۔ 1 چیز اس فون پر محفوظ ہے اور انٹرنیٹ آتے ہی خود بخود بھیج دی جائے گی۔',

    // Money units.
    'money.lakh': 'لاکھ',
    'money.crore': 'کروڑ',
    'money.rupees': 'روپے',

    // Project Home page.
    'home.complete': 'گھر مکمل ہو گیا۔',
    'home.status': '{stage}: {done} مکمل۔ اگلا کام: {next}۔',
    'home.started': '{stage} شروع ہو گیا۔ پہلے {next}۔',
    'home.finished': '{stage} مکمل ہو گیا۔',
    'home.built': '{n}% تعمیر',
    'home.next': 'اگلا: {step}',
    'home.spent': 'خرچ',
    'home.waiting': 'زیر التوا',
    'home.over': 'بجٹ سے زیادہ',
    'home.left': 'بجٹ میں باقی',
    'home.percentBuilt': '% تعمیر',
    'home.reportsWeek': 'اس ہفتے کی رپورٹیں',
    'home.waitingHead': 'زیر التوا',
    'home.review': 'منظوریاں دیکھیں',
    'home.addPurchase': 'خریداری درج کریں',

    // Today page.
    'today.title': 'آج',
    'today.reportTile': 'روزانہ رپورٹ',
    'today.reportDue': 'شام 6 بجے تک',
    'today.reportSent': 'آج بھیج دی گئی',
    'today.reportSaved': 'محفوظ، بھیجی جا رہی ہے',
    'today.purchaseTile': 'خریداری درج کریں',
    'today.purchaseHint': 'رسید ضروری ہے',
    'today.photo': 'تصویر لیں',
    'today.photoHint': 'کام، ڈیلیوری یا رسید',
    'today.uploadInstead': 'فائل سے اپ لوڈ کریں',
    'today.outbox': 'آؤٹ باکس',
    'today.outboxCount': '{n} محفوظ',
    'today.work': 'آج کا کام',
    'today.workHint': 'جو مرحلہ مکمل ہو جائے اسے آن کریں۔',
    'today.needs': 'آپ کے لیے',
    'today.allClear': 'آپ کے لیے کچھ زیر التوا نہیں۔',
    'today.photoSaved': 'تصویر محفوظ ہو گئی',
    'today.photosToday': 'آج کی {n} تصاویر',
    'today.photoToday': 'آج کی 1 تصویر',

    // Outbox.
    'outbox.REPORT': 'روزانہ رپورٹ، {n} تصاویر',
    'outbox.REPORT1': 'روزانہ رپورٹ، 1 تصویر',
    'outbox.PURCHASE': 'خریداری، {name}',
    'outbox.PHOTO': 'تصویر، {name}',
    'outbox.sending': 'بھیجی جا رہی ہے، {total} میں سے {sent} تصاویر',
    'outbox.sendingRecord': 'بھیجی جا رہی ہے',
    'outbox.saved': 'محفوظ {time}',
    'outbox.waiting': 'بہتر سگنل کا انتظار',
    'outbox.failed': 'نہیں بھیجی جا سکی: {error}',
    'outbox.savedToast': 'اس فون پر محفوظ ہو گئی۔ یہ خود بخود بھیج دی جائے گی۔',
    'outbox.saveFailed': 'فون پر محفوظ نہیں ہو سکی۔ جگہ خالی کریں یا پرائیویٹ براؤزنگ بند کریں، پھر دوبارہ کوشش کریں۔',
    'outbox.discardConfirm': 'فون سے ہٹا دیں؟ یہ ابھی بھیجی نہیں گئی۔',
    'outbox.signOutOne': '1 چیز ابھی بھیجی نہیں گئی۔ یہ فون پر محفوظ رہے گی اور اگلی بار سائن ان پر بھیج دی جائے گی۔ پھر بھی سائن آؤٹ کریں؟',
    'outbox.signOutMany': '{n} چیزیں ابھی بھیجی نہیں گئیں۔ یہ فون پر محفوظ رہیں گی اور اگلی بار سائن ان پر بھیج دی جائیں گی۔ پھر بھی سائن آؤٹ کریں؟',

    // Live camera.
    'camera.title': 'کیمرہ',
    'camera.RECEIPT': 'رسید',
    'camera.DELIVERY_PHOTO': 'ڈیلیوری',
    'camera.PHOTO': 'کام',
    'camera.live': 'لائیو کیمرہ',
    'camera.fromSite': 'سائٹ سے {d}',
    'camera.accuracy': 'جی پی ایس {a} میٹر تک درست',
    'camera.locating': 'مقام معلوم کیا جا رہا ہے…',
    'camera.noPin': 'سائٹ کا مقام ابھی طے نہیں',
    'camera.gpsOff': 'لوکیشن بند ہے',
    'camera.capture': 'تصویر لیں',
    'camera.retake': 'دوبارہ لیں',
    'camera.use': 'یہ تصویر استعمال کریں',
    'camera.switch': 'کیمرہ بدلیں',
    'camera.blocked': 'کیمرے کی اجازت نہیں ملی۔ براؤزر میں کیمرہ کی اجازت دیں یا فائل اپ لوڈ کریں۔',
    'camera.none': 'اس فون میں کیمرہ نہیں ملا۔ فائل اپ لوڈ کریں۔',

    // Step rows.
    'step.inspected': 'معائنہ ہو گیا، درست',
    'step.needsInspection': 'انجینئر کا معائنہ ضروری ہے',
    'step.needsFixes': 'معائنہ: اصلاح درکار',
    'step.through': '{n}% مکمل',
    'step.done': 'ہو گیا',
    'step.notDone': 'ابھی باقی',

    // Daily report wizard.
    'report.title': 'روزانہ رپورٹ',
    'report.step.work': 'آج کا کام',
    'report.step.photos': 'تصاویر',
    'report.step.notes': 'نوٹ',
    'report.stepOf': 'مرحلہ {n} از 3، {name}',
    'report.workIntro': 'اب تک مکمل ہونے والے مراحل آن کریں، پھر لکھیں کہ آج کیا کام ہوا۔',
    'report.summary': 'آج کیا کام ہوا؟',
    'report.summaryHint': 'مقدار ضرور لکھیں، مثلاً ”سامنے کی دیوار پر تقریباً 3000 اینٹیں لگائیں۔“',
    'report.stageDone': '{stage} مکمل طور پر ختم ہو گیا',
    'report.photosIntro': 'لائیو کیمرہ استعمال کریں۔ گیلری سے لی گئی تصاویر مالک کے لیے کم معتبر سمجھی جاتی ہیں۔',
    'report.addPhoto': 'تصویر شامل کریں',
    'report.caption': 'مالک کے لیے تفصیل',
    'report.workers': 'سائٹ پر مزدور',
    'report.weather': 'موسم',
    'report.issues': 'آج کے مسائل',
    'report.issuesHint': 'سامان کی کمی، بارش، نقشے کی کمی، جو بھی مالک کو معلوم ہونا چاہیے۔',
    'report.materials': 'آج استعمال ہونے والا سامان',
    'report.addMaterial': 'سامان شامل کریں',
    'report.nextPhotos': 'آگے: تصاویر',
    'report.nextNotes': 'آگے: نوٹ',
    'report.submit': 'رپورٹ بھیجیں',
    'report.submitted': 'رپورٹ بھیج دی گئی',

    // Purchase form.
    'purchase.new': 'نئی خریداری',
    'purchase.edit': 'خریداری میں ترمیم',
    'purchase.supplier': 'دکان یا جسے ادائیگی کی',
    'purchase.invoice': 'رسید یا پرچی نمبر',
    'purchase.date': 'خریداری کی تاریخ',
    'purchase.items': 'سامان',
    'purchase.item': 'چیز',
    'purchase.chooseItem': 'سامان کی فہرست سے چنیں…',
    'purchase.otherItem': 'فہرست میں نہیں',
    'purchase.qty': 'مقدار',
    'purchase.unit': 'اکائی',
    'purchase.rate': 'فی اکائی قیمت',
    'purchase.total': 'کل',
    'purchase.addItem': 'ایک اور چیز شامل کریں',
    'purchase.evidence': 'ثبوت',
    'purchase.evidenceCount': '{m} میں سے {n}',
    'purchase.receipt': 'رسید یا پرچی',
    'purchase.receiptHint': 'ہاتھ سے لکھی پرچی کی تصویر بھی چلے گی۔',
    'purchase.delivery': 'ڈیلیوری کی تصویر',
    'purchase.deliveryHint': 'سائٹ پر لائیو کیمرے سے لیں۔',
    'purchase.missingDelivery': 'بھیجنے کے لیے ڈیلیوری کی تصویر شامل کریں۔ سامان کی خریداری میں دونوں ضروری ہیں۔',
    'purchase.missingProof': 'بھیجنے کے لیے رسید یا پرچی شامل کریں۔',
    'purchase.fromAdvance': 'ایڈوانس سے ادا کیا',
    'purchase.fromAdvanceHint': 'مالک کا دیا ہوا ایڈوانس۔',
    'purchase.notes': 'نوٹ',
    'purchase.submit': 'منظوری کے لیے بھیجیں',
    'purchase.record': 'خریداری محفوظ کریں',
    'purchase.draft': 'مسودہ محفوظ کریں',

    // Progress page.
    'progress.title': 'پیش رفت',
    'progress.stageOf': 'مرحلہ {n} از {m}، {stage}',
    'progress.markComplete': '{stage} مکمل',
    'progress.reopen': 'پچھلا مرحلہ دوبارہ کھولیں',
    'progress.needsSignal': 'انٹرنیٹ درکار ہے۔ یہ روزانہ رپورٹ میں بھی درج کر سکتے ہیں۔',

    // Status chips: purchase states, then outbox states.
    'chip.expense.DRAFT': 'مسودہ',
    'chip.expense.SUBMITTED': 'ثبوت',
    'chip.expense.QUERIED': 'سوال',
    'chip.expense.APPROVED': 'منظور',
    'chip.expense.REJECTED': 'مسترد',
    'chip.expense.VERIFIED': 'تصدیق شدہ',
    'chip.expense.FLAGGED': 'قیمت دیکھیں',
    'chip.outbox.WAITING': 'انتظار',
    'chip.outbox.SENDING': 'بھیجی جا رہی',
    'chip.outbox.FAILED': 'نہیں گئی',
  },
}

/** Stage and step names in Urdu (as used on Pakistani sites). */
// Lookup table: English term (as sent by the server) -> Urdu. Keys that are a
// single plain word need no quotes (Blueprint); keys with spaces or brackets do.
// Used by term() in I18nProvider.
export const URDU_TERMS = {
  // Stage names (shared/houseConfig.js buildStages labels).
  Blueprint: 'نقشہ',
  Foundation: 'بنیاد',
  'Ground floor': 'گراؤنڈ فلور',
  'First floor': 'فرسٹ فلور',
  'Second floor': 'سیکنڈ فلور',
  'Third floor': 'تھرڈ فلور',
  'Fourth floor': 'فورتھ فلور',
  Roof: 'چھت',
  Finishing: 'فنشنگ',
  // Step names within the stages, in build order.
  'Architectural drawings': 'آرکیٹیکچرل نقشے',
  'Structural design': 'اسٹرکچرل ڈیزائن',
  'Authority approval': 'نقشے کی منظوری',
  Excavation: 'کھدائی',
  Footings: 'فٹنگز',
  Backfill: 'بھرائی',
  'Plinth beams': 'پلنتھ بیم',
  'DPC and plinth slab': 'ڈی پی سی',
  Columns: 'کالم',
  'Brick walls': 'اینٹوں کی دیواریں',
  'Slab casting': 'لینٹر ڈالنا',
  'Roof slab': 'چھت کا لینٹر',
  'Parapet wall': 'منڈیر',
  'Mumty (stair tower)': 'ممٹی',
  'Water tank': 'پانی کی ٹینکی',
  'Plaster and paint': 'پلستر اور رنگ',
  'Windows and doors': 'کھڑکیاں اور دروازے',
  'Boundary wall and gate': 'چار دیواری اور گیٹ',
  'Driveway and lawn': 'ڈرائیو وے اور لان',
  // Expense types (shared/records.js EXPENSE_TYPES labels).
  Material: 'سامان',
  Labour: 'مزدوری',
  'Equipment hire': 'مشینری کرایہ',
  Transport: 'ٹرانسپورٹ',
  Other: 'دیگر',
  // Weather choices on the daily report.
  Clear: 'صاف',
  Hot: 'گرم',
  Rain: 'بارش',
  Cloudy: 'ابر آلود',
  Windy: 'تیز ہوا',
}

/** One line under each step, saying what "done" means. */
// Lookup table: step name -> short English explanation (no Urdu version yet).
export const STEP_DETAILS = {
  // Blueprint steps.
  'Architectural drawings': 'Room layout and elevations',
  'Structural design': 'Columns, beams and slab design',
  'Authority approval': 'Approved building plan',
  // Foundation steps.
  Excavation: 'Trenches dug for the footings',
  Footings: 'Steel tied and footings cast',
  Backfill: 'Soil back in, compacted',
  'Plinth beams': 'Beams along the plinth cast',
  'DPC and plinth slab': 'Damp-proof course laid',
  // Floor steps.
  Columns: 'Column steel and concrete',
  'Brick walls': 'Outer and inner walls',
  'Slab casting': 'Roof of this floor cast',
  // Roof steps.
  'Roof slab': 'Top slab cast',
  'Parapet wall': 'Low wall around the roof',
  'Mumty (stair tower)': 'Stair room on the roof',
  'Water tank': 'Overhead tank placed',
  // Finishing steps.
  'Plaster and paint': 'Inside and outside',
  'Windows and doors': 'Frames, glass and main door',
  'Boundary wall and gate': 'Plot wall and gate',
  'Driveway and lawn': 'Paving and grass',
}

module.exports = [
  {
    type: 'heading',
    defaultValue: 'BusPebbIL Settings'
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'General'
      },
      {
        type: 'select',
        messageKey: 'RadiusM',
        label: 'Nearby radius',
        defaultValue: '400',
        options: [
          { label: '200 m', value: '200' },
          { label: '400 m', value: '400' },
          { label: '750 m', value: '750' },
          { label: '1000 m', value: '1000' }
        ]
      },
      {
        type: 'select',
        messageKey: 'RefreshSec',
        label: 'Refresh interval',
        defaultValue: '30',
        options: [
          { label: '15 sec', value: '15' },
          { label: '30 sec', value: '30' },
          { label: '60 sec', value: '60' }
        ]
      },
      {
        type: 'select',
        messageKey: 'Language',
        label: 'Language',
        defaultValue: 'auto',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'English', value: 'en' },
          { label: 'Hebrew', value: 'he' }
        ]
      },
      {
        type: 'select',
        messageKey: 'DefaultScreen',
        label: 'Default screen',
        defaultValue: 'favorites',
        options: [
          { label: 'Favorites', value: 'favorites' },
          { label: 'Nearby', value: 'nearby' }
        ]
      },
      {
        type: 'select',
        messageKey: 'MaxArrivals',
        label: 'Max arrivals',
        defaultValue: '12',
        options: [
          { label: '4 rows', value: '4' },
          { label: '6 rows', value: '6' },
          { label: '8 rows', value: '8' },
          { label: '12 rows', value: '12' },
          { label: '16 rows', value: '16' },
          { label: '20 rows', value: '20' },
          { label: '24 rows', value: '24' }
        ]
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Favorites'
      },
      {
        type: 'input',
        messageKey: 'ManualStopCode',
        label: 'Add stop code',
        description: 'Enter a public stop code to add it to favorites on save.'
      },
      {
        type: 'input',
        messageKey: 'FavoriteStopsJson',
        label: 'Favorite stops JSON',
        description: 'Example: [{"code":20004,"name":"HaMasger/Yad Harutsim","city":"Tel Aviv-Yafo","lat":32.061291,"lon":34.784847}]'
      },
      {
        type: 'input',
        messageKey: 'FavoriteLinesCsv',
        label: 'Favorite lines',
        description: 'Comma-separated line numbers, e.g. 5,25,480'
      },
      {
        type: 'input',
        messageKey: 'FavoriteLinesJson',
        label: 'Favorite lines JSON',
        description: 'Advanced: [{"line":"480","operator":"Egged"}]'
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Display'
      },
      {
        type: 'toggle',
        messageKey: 'ShowDestination',
        label: 'Show destination',
        defaultValue: true
      },
      {
        type: 'toggle',
        messageKey: 'ShowDistance',
        label: 'Show distance',
        defaultValue: true
      },
      {
        type: 'toggle',
        messageKey: 'ShowSourceBadge',
        label: 'Show source badge',
        defaultValue: true
      },
      {
        type: 'toggle',
        messageKey: 'DarkMode',
        label: 'Dark mode',
        defaultValue: false
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Alerts'
      },
      {
        type: 'select',
        messageKey: 'VibrateUnderMin',
        label: 'Vibrate under',
        defaultValue: '5',
        options: [
          { label: 'Off', value: '0' },
          { label: '3 minutes', value: '3' },
          { label: '5 minutes', value: '5' },
          { label: '10 minutes', value: '10' }
        ]
      },
      {
        type: 'toggle',
        messageKey: 'AlertOnlyFavoriteLines',
        label: 'Only favorite lines',
        defaultValue: false
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Advanced'
      },
      {
        type: 'toggle',
        messageKey: 'Debug',
        label: 'Debug mode',
        defaultValue: false
      },
      {
        type: 'toggle',
        messageKey: 'ClearCache',
        label: 'Clear cache on save',
        defaultValue: false,
        description: 'Clears arrivals and the daily phone GTFS snapshot.'
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Save'
  }
];

# Toggly React Native Example

This is an example Expo app demonstrating the Toggly React Native SDK.

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the App

```bash
npx expo start
```

In the output, you'll find options to open the app in a:
- Development build
- Android emulator
- iOS simulator
- Expo Go (scan the QR code with your phone)

## Features Demonstrated

### Home Screen (`app/index.tsx`)
- `TogglyProvider` setup with configuration options
- `Feature` component for conditional rendering
- `useFeatureFlag` hook for checking individual flags
- `useToggly` hook for identity management and refresh
- Pull-to-refresh for manual flag updates

### Features Screen (`app/features.tsx`)
- Displaying all feature flags with their current status
- `useFeatureGate` for combining multiple flags
- Different requirement modes: `all`, `any`, with `negate`

### Hooks Screen (`app/hooks.tsx`)
- Creating and registering custom hooks
- Logging feature evaluations, identity changes, and refreshes
- Understanding the hook lifecycle

## Configuration

To connect to your Toggly.io account, update the `TogglyProvider` in `app/_layout.tsx`:

```tsx
<TogglyProvider
  appKey="your-app-key"         // From Toggly.io
  environment="production"       // Your environment name
  storage={storage}
  // ... other options
>
```

## Project Structure

```
example-expo/
├── app/
│   ├── _layout.tsx     # Root layout with TogglyProvider
│   ├── index.tsx       # Home screen
│   ├── features.tsx    # Feature flags demo
│   └── hooks.tsx       # Hooks system demo
├── assets/             # App icons and splash screen
├── app.json            # Expo configuration
├── package.json        # Dependencies
└── tsconfig.json       # TypeScript configuration
```

## Learn More

- [Toggly Documentation](https://docs.toggly.io)
- [React Native SDK Guide](https://docs.toggly.io/sdks/react-native)
- [Expo Documentation](https://docs.expo.dev)

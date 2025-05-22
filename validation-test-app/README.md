# Validation Test App

A React application for testing video validation functionality. This app provides a user interface for testing various validation steps including hand gestures and poses.

## Features

- Real-time video capture and processing
- WebSocket communication for validation
- Support for multiple validation steps:
  - Hand raising (left, right, both hands)
  - Gestures (closed fist, open palm, thumbs up/down)
- Modern UI with Tailwind CSS
- TypeScript support

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Modern web browser with camera access

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Start the development server:
```bash
npm run dev
# or
yarn dev
```

3. Open your browser and navigate to `http://localhost:5173`

## Development

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

## Project Structure

```
validation-test-app/
├── src/
│   ├── App.tsx           # Main application component
│   ├── VideoTest.tsx     # Video validation component
│   ├── main.tsx         # Application entry point
│   └── index.css        # Global styles
├── public/              # Static assets
├── index.html          # HTML entry point
└── package.json        # Project dependencies and scripts
```

## WebSocket Communication

The app communicates with a backend server via WebSocket for real-time validation. The WebSocket connection is established at `ws://localhost:5173/ws/video/`.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

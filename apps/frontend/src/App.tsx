function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-bold text-gray-900">DevHandover AI</h1>
            <span className="text-sm text-gray-500">Backend API: <a href="http://localhost:3000/health" target="_blank" rel="noopener noreferrer" className="underline">http://localhost:3000</a></span>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">DevHandover AI Frontend</h2>
          <p className="text-gray-600 mb-8">Frontend scaffold - React + TypeScript + Vite + Tailwind CSS</p>
          <div className="space-x-4 justify-center">
            <a href="http://localhost:3000/health" target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              Health Check
            </a>
            <a href="http://localhost:3000/api/v1/projects" target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors">
              Projects API
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
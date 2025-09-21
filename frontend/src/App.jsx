import React, { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";

const API_BASE = "http://localhost:5000";

const App = () => {
  const [disks, setDisks] = useState([]);
  const [selectedDisk, setSelectedDisk] = useState("");
  const [taskType, setTaskType] = useState("wipe"); // "wipe" or "factory"
  const [method, setMethod] = useState("zero");
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const [certificate, setCertificate] = useState(null);
  const logRef = useRef(null);
  const [sudoPassword, setSudoPassword] = useState("");

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Fetch disks
  useEffect(() => {
    const fetchDisks = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/disks`);
        const data = await res.json();
        setDisks(data.disks || []);
      } catch (err) {
        setLog((prev) => [...prev, "❌ Failed to fetch disks"]);
      }
    };
    fetchDisks();
  }, []);

  // Start Task
  const handleStart = async () => {
    if (taskType === "wipe" && !selectedDisk) {
      setLog((prev) => [...prev, "❌ Please select a disk"]);
      return;
    }
    if (!sudoPassword) {
      setLog((prev) => [...prev, "❌ Please enter sudo password"]);
      return;
    }

    setProgress(0);
    setLog((prev) => [
      ...prev,
      `▶️ Started ${taskType === "wipe" ? "Disk Wipe" : "Factory Reset"}`
    ]);
    setCertificate(null);

    const endpoint =
      taskType === "wipe" ? "/api/wipe" : "/api/factory-reset";

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          taskType === "wipe"
            ? { device: selectedDisk, method, sudoPassword }
            : { sudoPassword }
        )
      });

      if (!res.ok) throw new Error("Failed to start task");

      // SSE connection
      const progressEndpoint =
        taskType === "wipe" ? "/api/wipe-progress" : "/api/factory-progress";

      const evtSource = new EventSource(`${API_BASE}${progressEndpoint}?_=${Date.now()}`);

      evtSource.onmessage = (e) => {
        const val = parseInt(e.data);
        if (!isNaN(val)) setProgress(val);
      };

      evtSource.addEventListener("done", (e) => {
        const data = JSON.parse(e.data);
        setLog((prev) => [...prev, `✅ Task Completed: ${data.status}`]);
        setCertificate(data);
        setProgress(100);
        evtSource.close();
      });

      evtSource.onerror = (err) => {
        setLog((prev) => [...prev, "❌ SSE connection error"]);
        evtSource.close();
      };
    } catch (err) {
      setLog((prev) => [...prev, "❌ Error starting task"]);
    }
  };

  // Generate PDF
  const handleDownloadPDF = () => {
    if (!certificate) return;
    const doc = new jsPDF();
    doc.text("Data Wiping / Factory Reset Certificate", 20, 20);
    if (certificate.device) doc.text(`Disk: ${certificate.device}`, 20, 40);
    if (certificate.method) doc.text(`Method: ${certificate.method}`, 20, 50);
    doc.text(`Status: ${certificate.status}`, 20, 60);
    doc.text(`Timestamp: ${new Date().toLocaleString()}`, 20, 70);
    doc.save("certificate.pdf");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-800 text-center">
          Secure Disk Wiper
        </h1>

        {/* Sudo Password */}
        <div className="space-y-2">
          <label className="block text-gray-700 font-medium">Sudo Password</label>
          <input
            type="password"
            value={sudoPassword}
            onChange={(e) => setSudoPassword(e.target.value)}
            placeholder="Enter sudo password"
            className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        {/* Task Type */}
        <div className="space-y-2">
          <label className="block text-gray-700 font-medium">Task Type</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="wipe">Disk Wipe</option>
            <option value="factory">Factory Reset</option>
          </select>
        </div>


        {/* Disk Selection (if wipe) */}
        {taskType === "wipe" && (
          <>
            <div className="space-y-2">
              <label className="block text-gray-700 font-medium">Select Disk</label>
              <select
                value={selectedDisk}
                onChange={(e) => setSelectedDisk(e.target.value)}
                className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="" disabled>-- Choose a Disk --</option>
                {disks.length > 0 ? (
                  disks.map((disk, idx) => (
                    <option key={idx} value={disk.name}>
                      {disk.name} ({disk.size})
                    </option>
                  ))
                ) : (
                  <option disabled>No disks found</option>
                )}
              </select>
            </div>

            {/* Method */}
            <div className="space-y-2">
              <label className="block text-gray-700 font-medium">Wipe Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="zero">Zero Fill</option>
                <option value="random">Random Data</option>
                <option value="dod">DoD 5220.22-M</option>
              </select>
            </div>
          </>
        )}

        {/* Start Button */}
        <button
          onClick={handleStart}
          className="w-full py-2 rounded-lg bg-green-500 text-white font-semibold hover:bg-green-600 transition disabled:opacity-50"
        >
          Start {taskType === "wipe" ? "Disk Wipe" : "Factory Reset"}
        </button>

        {/* Progress */}
        <div className="w-full bg-gray-200 rounded-lg h-6 relative">
          <div
            className="bg-green-500 h-6 rounded-lg transition-all duration-500 ease-in-out flex items-center justify-center text-white text-sm font-medium"
            style={{ width: `${progress}%` }}
          >
            {progress > 0 && <span className="absolute">{progress}%</span>}
          </div>
        </div>

        {/* Logs */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-800">Logs</h2>
          <div
            ref={logRef}
            className="h-40 overflow-y-auto border rounded-lg p-3 bg-gray-50 text-sm text-gray-700"
          >
            {log.map((entry, idx) => (
              <div key={idx}>• {entry}</div>
            ))}
          </div>
        </div>

        {/* Certificate */}
        {certificate && (
          <div className="border rounded-xl p-4 bg-green-50 shadow-sm space-y-3">
            <h2 className="text-lg font-semibold text-green-700">Certificate</h2>
            {certificate.device && <p className="text-sm text-gray-700">Disk: {certificate.device}</p>}
            {certificate.method && <p className="text-sm text-gray-700">Method: {certificate.method}</p>}
            <p className="text-sm text-gray-700">Status: {certificate.status}</p>
            <p className="text-sm text-gray-700">Timestamp: {new Date().toLocaleString()}</p>
            <button
              onClick={handleDownloadPDF}
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
            >
              Download PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { password } = req.body;
  const correct = process.env.APP_PASSWORD;

  if (!correct) return res.status(500).json({ error: "Mot de passe non configuré." });
  if (password === correct) return res.status(200).json({ success: true });
  return res.status(401).json({ error: "Mot de passe incorrect." });
}

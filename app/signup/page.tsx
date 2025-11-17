"use client";
import { useContext, useState } from "react";
import { AuthContext } from "@/src/context/AuthContext";


export default function SignUpPage() {
const { signUp } = useContext(AuthContext);
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [msg, setMsg] = useState("");


const handleSubmit = async () => {
const { error } = await signUp(email, password);
setMsg(error ? error.message : "Signup successful. Check email.");
};


return (
<div className="p-6 max-w-md mx-auto">
<h1 className="text-xl font-bold mb-4">Sign Up</h1>


<input className="border p-2 w-full mb-3" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
<input className="border p-2 w-full mb-3" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />


<button onClick={handleSubmit} className="bg-blue-600 text-white px-4 py-2 rounded">Sign Up</button>
<p className="mt-3 text-sm text-gray-600">{msg}</p>
</div>
);
}
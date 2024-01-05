export async function getNetworkStatistics(channel: RTCDataChannel) {
	const warmup = 4;
	const samples = 10;

	const decoder = new TextDecoder();

	// wait for warmup pings to return
	const warmupRoundtrip = new Promise<void>((resolve, reject) => {
		let count = 0;
		function warmupListener(event: MessageEvent<ArrayBuffer>) {
			if (event.data.byteLength != 4 || decoder.decode(event.data) !== 'ping') {
				reject("bad echo");
				return;
			}
			count++;
			if (count === warmup) {
				channel.removeEventListener('message', warmupListener);
				resolve();
			}
		}
		channel.addEventListener('message', warmupListener);
	});

	for (let i = 0; i < warmup; i++) {
		channel.send('ping');
		console.log("ping");
	}

	await warmupRoundtrip;

	const result = {
		roundtrip_times: new Array<number>(),
	};
	for (let i = 0; i < samples; i++) {
		// generate random 4 character message
		const message = Math.random().toString(36).substring(2, 6);
		const roundtrip = new Promise<number>((resolve, reject) => {
			function responseListener(event: MessageEvent<ArrayBuffer>) {
				const end = performance.now();
				channel.removeEventListener('message', responseListener);
				if (event.data.byteLength === message.length || decoder.decode(event.data) === message) {
					resolve(end);
				} else {
					reject("bad echo");
				}
			};
			channel.addEventListener('message', responseListener);
		});
		console.log(`ping ${message}`);
		const start = performance.now();
		channel.send(message);
		// wait for echo
		const end = await roundtrip;
		const roundtrip_ms = end - start;
		result.roundtrip_times.push(roundtrip_ms);
		console.log(`Roundtrip time: ${roundtrip_ms}ms`);
	}
	return result;
}
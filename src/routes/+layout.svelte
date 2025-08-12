<script>
	import '../app.css';
	
	// Accept but ignore SvelteKit props to prevent warnings
	export let data = undefined;
	export let params = undefined;
	export let url = undefined;
	export let route = undefined;
	
	// Silence unused variable warnings
	$: void (data, params, url, route);
</script>

<slot />

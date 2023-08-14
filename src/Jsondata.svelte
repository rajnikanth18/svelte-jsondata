<script>
    import { onMount } from 'svelte';	
	
	let sourceJson = "users";
    let users = [];
	let colNames = [];
	let search = undefined;
	$: visibleUsers = search ?
		users.filter(user => {
			return user.name.match(`${search}.*`) || user.username.match(`${search}.*`)
		}) : users;
		
    onMount(async () => {
		const resp = await fetch(`https://jsonplaceholder.typicode.com/`+sourceJson)
		const data = await resp.json();
		users = data;
		//grab column names
		colNames = Object.keys(users[0])
        console.log(users);
	});

	let sortBy = {col: "name", ascending: true};
	
	$: sort = (column) => {
		
		if (sortBy.col == column) {
			sortBy.ascending = !sortBy.ascending
		} else {
			sortBy.col = column
			sortBy.ascending = true
		}
		
		let sortModifier = (sortBy.ascending) ? 1 : -1;
		
		let sort = (a, b) => 
			(a[column] < b[column]) 
			? -1 * sortModifier 
			: (a[column] > b[column]) 
			? 1 * sortModifier 
			: 0;
		
		users = users.sort(sort);
	}
	
</script>

<input type="search" bind:value={search} placeholder="Search" />
<table rows={visibleUsers}>
		<tr>
			{#each colNames as col}
			<th on:click={sort(col)}>{col} &varr;</th>
			{/each}
		</tr>
        {#each visibleUsers as user, index}				
		<tr>
			<td>{user.id}</td>
			<td>{user.name}</td>
			<td>{user.username}</td>
			<td>{user.email}</td>
			<td>{user.address.street}</td>
			<td>{user.phone}</td>
			<td>{user.website}</td>
			<td>{user.company.name}</td>
		</tr>
		{/each}	
</table>


(( ) => {
    try {
        self.localStorage.removeItem('fs.cdi');
        self.localStorage.removeItem('fs.cfc');
    } catch {
    }
})();

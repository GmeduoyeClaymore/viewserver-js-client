import Logger from 'common/Logger';

export default class GenericJSONCommandPromise{
  constructor(){
    this.promise = new Promise(this._handlePromiseExecution.bind(this));
    this.onSuccess = this.onSuccess.bind(this);
    this.onError = this.onError.bind(this);
  }

  then () {
	    return this.promise.then.apply(this.promise, arguments);
  }

  get timeoutWithError(){
    return this.promise.timeoutWithError;
  }

  _handlePromiseExecution(resolve, reject){
    this.resolve = arg => { resolve(arg); this.dispose(); };
    this.reject = arg => { reject(arg); this.dispose(); };
  }

  onError(message){
    Logger.warning(`Generic JSON command handler returned error "${message}"`);
    this.reject(message);
  }

  onSuccess(commandResultId, message){
    Logger.fine(`Command successfully executed with the following message "${message}"`);
    try {
      try {
        const argument = message ? JSON.parse(message) : undefined;
        this.resolve(argument);
      } catch (error){
        Logger.warning(`Unable to parse response to json ${error} resolving command with a ${message}`);
        this.resolve(message);
      }
    } catch (err) {
      Logger.warning(`Unable to parse message ${message} resolving command with a null`);
      this.resolve();
    }
  }

  dispose(){
  }
}

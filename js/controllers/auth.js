import { UserModel } from '../models/user.js';
import { AutomationModel } from '../models/automation.js';

export class AuthController {
    static async login(email, password, remember) {
        const result = await UserModel.login(email, password, remember);
        if (result.success) {
            await UserModel.updateStats(result.user.id, { gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 });
            await AutomationModel.load(result.user.id);
            return { success: true, user: result.user, session: result.session };
        }
        return result;
    }

    static async register(name, email, password) {
        return await UserModel.register(name, email, password);
    }

    static async validateSession() {
        const result = await UserModel.validateSession();
        if (result) {
            await AutomationModel.load(result.user.id);
            return result;
        }
        return null;
    }

    static async logout(sessionId) {
        await UserModel.logout(sessionId);
    }
}
